import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const OWNERSHIP_PATH = path.join('C:/user-data', 'system-proxy-rollback.json');
const NAMES = ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL'];

function snapshot(values = {}) {
  return Object.fromEntries(NAMES.map(name => [name, { exists: false, value: null, ...values[name] }]));
}

function registryOutput(values) {
  return [REG_PATH, ...NAMES.flatMap(name => {
    const entry = values[name];
    return entry.exists ? [`    ${name}    ${name === 'ProxyEnable' ? 'REG_DWORD' : 'REG_SZ'}    ${entry.value}`] : [];
  })].join('\r\n');
}

function rollback(original) {
  return {
    schemaVersion: 2,
    owner: 'EgoistShield',
    sessionId: 'test-session',
    revision: 1,
    managedEndpoints: ['127.0.0.1:1080'],
    managedEndpoint: '127.0.0.1:1080',
    original,
    capturedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    proxyServer: '127.0.0.1:1080',
    values: original,
  };
}

function loadProxy({ values = snapshot(), failQuery = false, failAdd = () => false, failDelete = () => false, savedRollback = null, queryOutput = null } = {}) {
  const calls = [];
  const removed = [];
  const files = new Map(savedRollback ? [[OWNERSHIP_PATH, JSON.stringify(savedRollback)]] : []);
  const fs$1 = {
    readFile: async file => {
      if (!files.has(file)) throw new Error('ENOENT');
      return files.get(file);
    },
    mkdir: async () => {},
    writeFile: async (file, contents) => { files.set(file, contents); },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    rm: async file => { removed.push(file); files.delete(file); },
  };
  const { readProxyValues, enableSystemProxy, disableSystemProxy, sameRegistryValue, configureSystemProxyOwnershipState } = loadRecovered('electron/ipc/system-proxy', {
    process: { platform: 'win32', pid: 1234 },
    path,
    fs: { existsSync: () => false },
    fs$1,
    randomUUID: () => 'test-uuid',
    logger: { warn() {}, error() {} },
    resolveWindowsExecutable: name => name,
    execFile: async (executable, args, options) => {
      calls.push({ executable, args, options });
      if (args[0] === 'query') {
        if (failQuery) throw new Error('reg.exe timed out');
        return { stdout: queryOutput ?? registryOutput(values) };
      }
      if (args[0] === 'add') {
        const name = args[3];
        const value = args[7];
        if (failAdd(name, value)) throw new Error(`reg add ${name} failed`);
        values[name] = { exists: true, value };
        return { stdout: '' };
      }
      if (args[0] === 'delete') {
        const name = args[3];
        if (failDelete(name)) throw new Error(`reg delete ${name} failed`);
        values[name] = { exists: false, value: null };
        return { stdout: '' };
      }
      return { stdout: '' };
    },
    promisify: fn => fn,
  }, ['readProxyValues', 'enableSystemProxy', 'disableSystemProxy', 'sameRegistryValue', 'configureSystemProxyOwnershipState']);
  configureSystemProxyOwnershipState('C:/user-data');
  return { readProxyValues, enableSystemProxy, disableSystemProxy, sameRegistryValue, calls, removed, files, values };
}

test('a whole-key registry query timeout aborts proxy enable before any registry mutation', async () => {
  const { enableSystemProxy, calls } = loadProxy({ failQuery: true });

  await assert.rejects(() => enableSystemProxy(1080), /timed out/);
  assert.equal(calls.filter(call => call.args[0] === 'add' || call.args[0] === 'delete').length, 0);
});

test('a successful whole-key query represents genuinely missing proxy values as absent', async () => {
  const { readProxyValues } = loadProxy({ values: snapshot() });
  const values = await readProxyValues();

  for (const name of NAMES) {
    assert.equal(values[name].exists, false);
    assert.equal(values[name].value, null);
  }
});

test('a whole-key query canonicalizes case-insensitive registry value names', async () => {
  const { readProxyValues } = loadProxy({ queryOutput: [
    REG_PATH,
    '    proxyenable    REG_DWORD    0x1',
    '    PROXYSERVER    REG_SZ    127.0.0.1:1080',
  ].join('\r\n') });
  const values = await readProxyValues();

  assert.equal(values.ProxyEnable.value, '0x1');
  assert.equal(values.ProxyServer.value, '127.0.0.1:1080');
  assert.equal(values.ProxyOverride.exists, false);
});

test('ProxyEnable comparison treats decimal and hexadecimal DWORD text as equal', () => {
  const { sameRegistryValue } = loadProxy();

  assert.equal(sameRegistryValue('ProxyEnable', { exists: true, value: '0x1' }, { exists: true, value: '1' }), true);
  assert.equal(sameRegistryValue('ProxyEnable', { exists: true, value: '0x0' }, { exists: true, value: '0' }), true);
});

test('a failed delete during disable keeps the rollback journal and reports failure', async () => {
  const original = snapshot({
    ProxyEnable: { exists: true, value: '0x0' },
    ProxyServer: { exists: true, value: 'proxy.example:8080' },
    ProxyOverride: { exists: true, value: '<local>' },
  });
  const current = snapshot({
    ProxyEnable: { exists: true, value: '0x1' },
    ProxyServer: { exists: true, value: '127.0.0.1:1080' },
    ProxyOverride: { exists: true, value: '<local>;127.*' },
    AutoConfigURL: { exists: true, value: 'https://external.example/proxy.pac' },
  });
  const { disableSystemProxy, removed, files } = loadProxy({ values: current, savedRollback: rollback(original), failDelete: name => name === 'AutoConfigURL' });

  const result = await disableSystemProxy();

  assert.equal(result.ok, false);
  assert.equal(result.restored, false);
  assert.equal(removed.length, 0);
  assert.equal(files.has(OWNERSHIP_PATH), true);
});

test('a failed enable rollback retains its journal when an attempted write may have committed', async () => {
  const original = snapshot({
    ProxyEnable: { exists: true, value: '0' },
    ProxyServer: { exists: true, value: 'proxy.example:8080' },
    ProxyOverride: { exists: true, value: '<local>' },
  });
  const { enableSystemProxy, removed, files, values } = loadProxy({
    values: original,
    failAdd: (name, value) => (name === 'ProxyServer' && value === '127.0.0.1:1080') || (name === 'ProxyEnable' && value === '0'),
  });

  const result = await enableSystemProxy(1080);

  assert.equal(result.ok, false);
  assert.equal(values.ProxyEnable.value, '1');
  assert.equal(removed.length, 0);
  assert.equal(files.has(OWNERSHIP_PATH), true);
});

test('a failed owned reconnect restores its pre-transaction proxy and preserves the original-session journal', async () => {
  const original = snapshot({
    ProxyEnable: { exists: true, value: '0' },
    ProxyServer: { exists: true, value: 'proxy.example:8080' },
    ProxyOverride: { exists: true, value: '<local>' },
  });
  const { enableSystemProxy, disableSystemProxy, files, values } = loadProxy({
    values: original,
    failAdd: (name, value) => name === 'ProxyServer' && value === '127.0.0.1:1081',
  });

  assert.equal((await enableSystemProxy(1080)).ok, true);
  assert.equal((await enableSystemProxy(1081)).ok, false);
  assert.equal(values.ProxyEnable.value, '1');
  assert.equal(values.ProxyServer.value, '127.0.0.1:1080');
  assert.equal(JSON.parse(files.get(OWNERSHIP_PATH)).managedEndpoint, '127.0.0.1:1080');

  const disabled = await disableSystemProxy();
  assert.equal(disabled.restored, true);
  assert.equal(values.ProxyEnable.value, '0');
  assert.equal(values.ProxyServer.value, 'proxy.example:8080');
  assert.equal(values.ProxyOverride.value, '<local>');
});

test('a restore failure leaves ProxyServer owned so a later retry can restore the user snapshot', async () => {
  const original = snapshot({
    ProxyEnable: { exists: true, value: '0' },
    ProxyServer: { exists: true, value: 'proxy.example:8080' },
    ProxyOverride: { exists: true, value: '<local>' },
  });
  let failOverrideOnce = true;
  const { disableSystemProxy, calls, values } = loadProxy({
    values: snapshot({
      ProxyEnable: { exists: true, value: '1' },
      ProxyServer: { exists: true, value: '127.0.0.1:1080' },
      ProxyOverride: { exists: true, value: '<local>;127.*' },
    }),
    savedRollback: rollback(original),
    failAdd: (name, value) => {
      if (name !== 'ProxyOverride' || value !== '<local>' || !failOverrideOnce) return false;
      failOverrideOnce = false;
      return true;
    },
  });

  assert.equal((await disableSystemProxy()).ok, false);
  assert.equal(values.ProxyServer.value, '127.0.0.1:1080');
  assert.equal(calls.some(call => call.args[0] === 'add' && call.args[3] === 'ProxyServer' && call.args[7] === 'proxy.example:8080'), false);

  assert.equal((await disableSystemProxy()).restored, true);
  assert.equal(values.ProxyServer.value, 'proxy.example:8080');
  assert.equal(values.ProxyOverride.value, '<local>');
});
