import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { sourceFor } from './load-recovered.mjs';

test('opening the app does not start deliberately stopped background services', async () => {
  let starts = 0;
  const manager = { status: async () => ({ serviceInstalled: true, serviceRunning: false }),
    startService: async () => { starts++; } };
  const source = sourceFor('electron/main');
  const start = source.indexOf('async function recoverBackgroundFeaturesAfterRendererLoad');
  const end = source.indexOf('\n/**', start);
  const context = vm.createContext({
    logger: { info() {}, warn() {}, error() {} },
    isGravitylessLoopbackDnsRequest: () => false,
    globalSystemDohManager: null, globalGravitylessDnsManager: null,
    globalNetworkCombinatorManager: null,
    globalZapretManager: manager, globalTelegramProxyManager: manager,
    startDnsWatchdog() {},
  });
  vm.runInContext(source.slice(start, end), context);
  await context.recoverBackgroundFeaturesAfterRendererLoad({ settings: {} });
  assert.equal(starts, 0);
});
