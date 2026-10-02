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
    async status() { return { running: this.running, serviceRunning: this.running, verified: false }; }
    async stopAndRemove() { this.running = false; return { ok: true }; }
  }
  const controller = new ShieldConnectionController({ dns: new Dns() });
  assert.equal((await controller.prepareDnsForAutoSelect({ running: false, serviceRunning: false })).running, false);
});

test('direct DNS preparation preserves configured stopped DNS without invoking cleanup', async () => {
  let stopped = false;
  await assert.rejects(prepareZapretProbeDns({
    status: async () => ({ running: false, serviceRunning: false, enabled:true }),
    stopAndRemove: async () => { stopped = true; return { ok: false, message: 'Restore pending' }; }
  }), /DNS/);
  assert.equal(stopped, false);
});

for (const mode of ['direct', 'shield']) {
  test(`${mode} DNS preparation requires affirmative verification for a remaining resolver`, async () => {
    const dns = { status: async () => ({ running: true }), stopAndRemove: async () => ({ ok: true }) };
    const prepare = mode === 'direct' ? () => prepareZapretProbeDns(dns)
      : () => new ShieldConnectionController({ dns }).prepareDnsForAutoSelect({ running: true });
    await assert.rejects(prepare(), /DNS/);
  });
}

test('Shield preserves newly enabled candidate with missing verification without saving connected', async () => {
  const calls = [];
  let running = false;
  const controller = new ShieldConnectionController({
    coordinate: async (_action, operation) => operation(),
    zapret: { status: async () => ({ serviceRunning: true, serviceProfile: 'general' }) },
    dns: { status: async () => ({ running, serviceRunning:running }) },
    applyDns: async () => { running = true; return { ok: true }; },
    resetDns: async () => { calls.push('reset'); running = false; return { ok: true }; },
    saveConnected: async () => { calls.push('save'); }
  });
  assert.equal((await controller.connect({ telegramEnabled: false })).ok, false);
  assert.deepEqual(calls, []);
  assert.equal(running, true, 'Unverified candidate remains owned');
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
      status: async () => { entered(); await new Promise(resolve => { release = resolve; }); return { running:false, serviceRunning:false, enabled:false, serviceState:'not-installed' }; },
      stopAndRemove: async () => { assert.fail('DNS query preparation must never remove the foundation'); }
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

const unsafeDnsStates = [
  ['running but unverified', { running: true, verified: false, serviceRunning: true }],
  ['running with missing verification', { running: true, serviceRunning: true }],
  ['live service with failed upstream verification', { running: false, verified: false, serviceRunning: true }],
  ['native DNS still enabled', { running: false, verified: false, serviceRunning: false, nativeManaged: true, enabled: true, serviceState: 'native' }],
  ['unknown running flag', { serviceRunning: false, verified: false }],
  ['missing service status', { running: false, verified: false }],
  ['unavailable native inspection', { running: false, serviceRunning: false, nativeManaged: true, enabled: false, available: false, serviceState: 'unavailable' }],
  ['failed owner inspection', { running: false, serviceRunning: false, serviceState: 'unknown', ownerInspectionErrors: [{ code: 'SYSTEM_DOH_SERVICE_QUERY_FAILED' }] }],
  ['service start pending', { running: false, serviceRunning: false, serviceState: 'start-pending' }]
];
for (const mode of ['direct', 'shield']) {
  for (const [description, status] of unsafeDnsStates) {
    test(`${mode} auto-select preserves ${description} and never probes profiles`, async () => {
      const calls = [];
      const dns = { status: async () => status, stopAndRemove: async () => { calls.push('stop-dns'); return { ok: true }; } };
      const zapret = { status: async () => ({ serviceRunning: false }), autoSelectBestProfile: async () => { calls.push('probe'); return { completed: false }; } };
      if (mode === 'direct') {
        const handlers = new Map();
        const { registerZapretHandlers } = loadRecovered('electron/ipc/handlers-zapret', {
          ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
        }, ['registerZapretHandlers']);
        registerZapretHandlers({ runtimeManager: { status: async () => ({ connected: false }) }, systemDohManager: dns, zapretManager: zapret });
        await assert.rejects(handlers.get('zapret:auto-select')({ sender: { isDestroyed: () => false, send() {} } }), /DNS/);
      } else {
        const controller = new ShieldConnectionController({ coordinate: async (_action, operation) => operation(), dns, zapret,
          applyDns: async () => { calls.push('apply-dns'); }, saveConnected: async () => { calls.push('save'); } });
        const result = await controller.connect({ telegramEnabled: false });
        assert.equal(result.ok, false);
        assert.match(result.message, /DNS/);
      }
      assert.deepEqual(calls, []);
    });
  }
  test(`${mode} DNS preparation preserves a healthy verified resolver`, async () => {
    const status = { running: true, serviceRunning: true, verified: true };
    let stopped = false;
    const dns = { status: async () => status, stopAndRemove: async () => { stopped = true; return { ok: true }; } };
    if (mode === 'direct') await prepareZapretProbeDns(dns);
    else assert.equal(await new ShieldConnectionController({ dns }).prepareDnsForAutoSelect(status), status);
    assert.equal(stopped, false);
  });
  test(`${mode} DNS preparation preserves configured stopped DNS without restoration`, async () => {
    const stopped = { running: false, serviceRunning: false, serviceState: 'stopped', enabled:true };
    let reads = 0, restores = 0;
    const dns = { status: async () => mode === 'direct' && ++reads === 1 ? stopped : { running: false, serviceRunning: false, serviceState: 'unknown' },
      stopAndRemove: async () => { restores++; return { ok: true }; } };
    const prepare = mode === 'direct' ? () => prepareZapretProbeDns(dns) : () => new ShieldConnectionController({ dns }).prepareDnsForAutoSelect(stopped);
    await assert.rejects(prepare(), /DNS/);
    assert.equal(restores, 0);
  });
}

for (const [description, status] of unsafeDnsStates) {
  test(`Shield repeated connect preserves ${description} with an already running profile`, async () => {
    const calls = [];
    const controller = new ShieldConnectionController({
      coordinate: async (_action, operation) => operation(),
      dns: { status: async () => status, stopAndRemove: async () => { calls.push('stop-dns'); return { ok: true }; } },
      zapret: { status: async () => ({ serviceRunning: true, serviceProfile: 'general' }) },
      applyDns: async () => { calls.push('apply-dns'); return { ok: true }; },
      resetDns: async () => { calls.push('reset-dns'); return { ok: true }; },
      saveConnected: async () => { calls.push('save'); }
    });
    const result = await controller.connect({ telegramEnabled: false });
    assert.equal(result.ok, false);
    assert.match(result.message, /DNS/);
    assert.deepEqual(calls, []);
  });
}

for (const initiallyRunning of [true, false]) {
  test(`Shield repeated connect ${initiallyRunning ? 'keeps healthy DNS untouched' : 'initializes inactive selected DNS without teardown'}`, async () => {
    const calls = [];
    let running = initiallyRunning;
    const controller = new ShieldConnectionController({
      coordinate: async (_action, operation) => operation(),
      dns: { status: async () => ({ running, serviceRunning: running, verified: running }),
        stopAndRemove: async () => { calls.push('restore'); return { ok: true }; } },
      zapret: { status: async () => ({ serviceRunning: true, serviceProfile: 'general' }) },
      applyDns: async () => { calls.push('apply'); running = true; return { ok: true }; },
      saveConnected: async () => { calls.push('save'); }
    });
    assert.equal((await controller.connect({ telegramEnabled: false })).ok, true);
    assert.deepEqual(calls, initiallyRunning ? ['save'] : ['apply', 'save']);
    assert.equal(running, true);
  });
}
