import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { promisify } from 'node:util';
import { z } from 'zod';
import { loadRecovered, sourceFor } from './load-recovered.mjs';

function fixture(mode = 'none') {
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path, promisify, execFile() { throw new Error('Unexpected system command'); },
    package_default: { version: '3.6.1' },
  }, ['ZapretManager']);
  const worker = new ZapretManager('resources', 'app', 'user-data', 'runtime', null);
  worker.suspendedByVpnMode = mode;
  worker.suspendedProfileDuringVpn = mode === 'none' ? null : 'Remembered profile';
  const events = [];
  worker.status = async options => {
    events.push(['status', options.force]);
    return { serviceRunning: mode === 'service', standaloneRunning: mode === 'standalone' };
  };
  worker.readServiceProfile = async () => 'Remembered profile';
  worker.queryService = async () => ({ installed: true });
  worker.startService = async () => events.push(['start-service']);
  worker.startStandalone = async profile => events.push(['start-standalone', profile]);

  const context = vm.createContext({
    z, URL, TelegramProxyConfigSchema: z.object({}), ZapretProfileInputSchema: z.string().min(1),
    ZapretUserListsInputSchema: z.object({}), ZapretGameFilterModeSchema: z.string(),
    ZapretIpsetModeSchema: z.string(), ZapretCoreVersionInputSchema: z.string(),
  });
  vm.runInContext(fs.readFileSync('src/component-protocol.js', 'utf8') + '\n' +
    fs.readFileSync('src/component-facade.js', 'utf8') +
    '\nglobalThis.validate = validateComponentRequest; globalThis.wrap = useComponentService;', context);
  const requests = [];
  const core = { async request(operation, payload) {
    requests.push({ operation, payload });
    const request = context.validate({ id: 'shutdown-test', ...payload, query: operation === 'component.query' });
    return worker[request.method](...request.args);
  } };
  // The desktop field stays idle even when the authoritative Core worker suspended Zapret.
  const desktop = context.wrap({ suspendedByVpnMode: 'none' }, 'Zapret', core);
  return { worker, desktop, events, requests };
}

test('shutdown skips the idle worker status scan through the real facade and protocol', async () => {
  const f = fixture();
  const main = sourceFor('electron/main');
  const start = main.indexOf('async function performGracefulShutdown()');
  const end = main.indexOf('\napp.on("before-quit"', start);
  const context = vm.createContext({
    globalStateStore: { get: () => ({ settings: { zapretSuspendDuringVpn: true, zapretProfile: 'General' } }) },
    globalRuntimeManager: null, globalZapretManager: f.desktop, globalTelegramProxyManager: null,
    logger: { info() {}, warn() {} }, setTimeout, clearTimeout,
  });
  vm.runInContext(sourceFor('electron/shutdown-coordinator') + '\n' + main.slice(start, end), context);
  await context.performGracefulShutdown();
  assert.deepEqual(f.events, [], 'an idle shutdown must not query status or start any component');
  assert.equal(f.requests.length, 1, 'the authoritative worker still receives the restore request');
  assert.equal(f.requests[0].operation, 'component.execute');
  assert.equal(f.requests[0].payload.args[2]?.skipIdleStatus, true);
});

test('ordinary idle restores preserve their status return contract', async () => {
  for (const options of [undefined, {}, { skipIdleStatus: false }]) {
    const f = fixture();
    const result = options === undefined
      ? await f.desktop.restoreAfterVpnIfNeeded(true, 'General')
      : await f.desktop.restoreAfterVpnIfNeeded(true, 'General', options);
    assert.deepEqual(f.events, [['status', true]]);
    assert.deepEqual(result, { serviceRunning: false, standaloneRunning: false });
  }
});

test('shutdown restores genuine worker suspension despite an idle desktop marker', async () => {
  for (const mode of ['service', 'standalone']) {
    const f = fixture(mode);
    const result = await f.desktop.restoreAfterVpnIfNeeded(true, 'Preferred profile', { skipIdleStatus: true });
    assert.equal(f.desktop.suspendedByVpnMode, 'none');
    assert.deepEqual(f.events, [
      mode === 'service' ? ['start-service'] : ['start-standalone', 'Remembered profile'],
      ['status', true],
    ]);
    assert.equal(result.serviceRunning || result.standaloneRunning, true);
    assert.equal(f.worker.suspendedByVpnMode, 'none');
    assert.equal(f.worker.suspendedProfileDuringVpn, null);
  }
});

test('failed shutdown restoration retains the worker suspension marker', async () => {
  const f = fixture('service');
  f.worker.startService = async () => { throw new Error('Restore failed'); };
  await assert.rejects(f.desktop.restoreAfterVpnIfNeeded(true, 'General', { skipIdleStatus: true }), /Restore failed/);
  assert.equal(f.worker.suspendedByVpnMode, 'service');
  assert.equal(f.worker.suspendedProfileDuringVpn, 'Remembered profile');
  assert.deepEqual(f.events, []);
});

test('shutdown options remain a strict boolean-only protocol object', async () => {
  for (const options of [{ skipIdleStatus: 'true' }, { skipIdleStatus: true, command: 'unexpected' }, true]) {
    const f = fixture();
    await assert.rejects(f.desktop.restoreAfterVpnIfNeeded(true, 'General', options));
    assert.deepEqual(f.events, []);
  }
});
