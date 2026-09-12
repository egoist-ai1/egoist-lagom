import test from 'node:test';
import assert from 'node:assert/strict';
import { compactAutoSelectResult } from '../src/component-response.js';
import { ShieldConnectionController } from '../src/shield-connection-controller.js';
import { loadRecovered } from './load-recovered.mjs';

const { prepareZapretProbeDns, registerZapretHandlers } = loadRecovered('electron/ipc/handlers-zapret', {
  ipcMain: { handle() {} }
}, ['prepareZapretProbeDns', 'registerZapretHandlers']);

test('Shield DNS recovery preserves the manager receiver', async () => {
  class Dns {
    running = false;
    async status() { return { running: this.running, verified: false }; }
    async stopAndRemove() { this.running = false; return { ok: true }; }
  }
  const controller = new ShieldConnectionController({ dns: new Dns() });
  assert.equal((await controller.prepareDnsForAutoSelect({ running: false })).running, false);
});

test('direct DNS preparation rejects an explicit failed restore even with a stopped readback', async () => {
  await assert.rejects(prepareZapretProbeDns({
    status: async () => ({ running: false }),
    stopAndRemove: async () => ({ ok: false, message: 'Restore pending' })
  }), /Restore pending/);
});

for (const mode of ['direct', 'shield']) {
  test(`${mode} DNS preparation requires affirmative verification for a remaining resolver`, async () => {
    const dns = { status: async () => ({ running: true }), stopAndRemove: async () => ({ ok: true }) };
    const prepare = mode === 'direct' ? () => prepareZapretProbeDns(dns)
      : () => new ShieldConnectionController({ dns }).prepareDnsForAutoSelect({ running: true });
    await assert.rejects(prepare(), /DNS/);
  });
}

test('Shield rolls back newly enabled DNS with missing verification instead of saving connected', async () => {
  const calls = [];
  let running = false;
  const controller = new ShieldConnectionController({
    coordinate: async (_action, operation) => operation(),
    zapret: { status: async () => ({ serviceRunning: true, serviceProfile: 'general' }) },
    dns: { status: async () => ({ running }) },
    applyDns: async () => { running = true; return { ok: true }; },
    resetDns: async () => { calls.push('reset'); running = false; return { ok: true }; },
    saveConnected: async () => { calls.push('save'); }
  });
  assert.equal((await controller.connect({ telegramEnabled: false })).ok, false);
  assert.deepEqual(calls, ['reset']);
});

test('direct auto-select cancellation during DNS preparation never starts a probe', async () => {
  const handlers = new Map();
  const { registerZapretHandlers } = loadRecovered('electron/ipc/handlers-zapret', {
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
  }, ['registerZapretHandlers']);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let probes = 0;
  registerZapretHandlers({
    runtimeManager: { status: async () => ({ connected: false }) },
    systemDohManager: {
      status: async () => ({ running: false }),
      stopAndRemove: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { ok: true }; }
    },
    zapretManager: {
      autoSelectBestProfile: async () => { probes++; return { completed: true }; },
      cancelAutoSelect: async () => ({ ok: true })
    }
  });
  const pending = handlers.get('zapret:auto-select')({ sender: { isDestroyed: () => false, send() {} } });
  await started;
  await handlers.get('zapret:cancel-auto-select')();
  release();
  assert.equal((await pending).cancelled, true);
  assert.equal(probes, 0);
});

for (const character of ['漢', '\u0000', '\ud800']) {
  test(`auto-select budget survives 64 rows of escaped/Unicode text ${JSON.stringify(character)}`, () => {
    const long = character.repeat(3000);
    const results = Array.from({ length: 64 }, () => ({
      ...Object.fromEntries(['id', 'configId', 'configName', 'name', 'result', 'testedAt', 'verification', 'error'].map(key => [key, long])),
      targets: Array.from({ length: 17 }, (_, index) => ({
        key: `target-${index}`, label: long, url: long, error: long, ok: index === 16, pingMs: 12
      }))
    }));
    const compact = compactAutoSelectResult({ completed: true, bestProfile: 'general', results });
    assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= 220 * 1024);
    assert.equal(compact.results.length, 64);
    assert.ok(compact.results.every(row => row.targets.some(target => target.key === 'target-16' && target.ok)));
    assert.equal(results[0].targets.length, 17);
  });
}

test('compaction keeps truthful target totals and marks any omitted previews', () => {
  const targets = Array.from({ length: 300 }, (_, index) => ({ key: `target-${index}`, ok: index === 299 }));
  const compact = compactAutoSelectResult({ results: Array.from({ length: 64 }, () => ({ id: 'general', targets })) });
  assert.ok(Buffer.byteLength(JSON.stringify(compact), 'utf8') <= 220 * 1024);
  for (const row of compact.results) {
    assert.equal(row.totalTargets, 300);
    assert.equal(row.passedTargets, 1);
    assert.equal(row.targetsOmitted, 300 - row.targets.length);
    assert.ok(row.targets.some(target => target.ok));
  }
});
