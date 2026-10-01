import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = process.cwd();
const { loadRecovered } = await import(pathToFileURL(path.join(project, 'tests', 'load-recovered.mjs')));
const calls = [];
const { TelegramProxyManager } = loadRecovered('electron/ipc/telegram-proxy-manager', {
  path: path.win32, process: { env: {}, platform: 'win32' },
  promisify: fn => fn,
  execFile: async (executable) => { calls.push(executable); throw new Error('inert WinPS unavailable fixture'); },
  resolveWindowsExecutable: name => name,
}, ['TelegramProxyManager']);

for (const state of ['not-installed', 'stopped']) {
  test(`native read-only listener path must also serve ${state} service preflight`, async () => {
    const manager = new TelegramProxyManager('resources', 'app', 'user', 'C:\\Fixture\\Telegram');
    let nativeCalls = 0;
    manager.queryNativeServiceListenerOwnership = async () => { nativeCalls++; return { state: 'none', ownerPid: null, ownerName: null }; };
    const result = await manager.queryListenerOwnership(1443, '127.0.0.1', { serviceRunning: false });
    assert.equal(nativeCalls, 1, 'direct native branch remains reachable when owned SCM service is absent or stopped');
    assert.equal(result.state, 'none');
  });
}

test('running-service native path is already reachable with unavailable WinPS', async () => {
  const manager = new TelegramProxyManager('resources', 'app', 'user', 'C:\\Fixture\\Telegram');
  let nativeCalls = 0;
  manager.queryNativeServiceListenerOwnership = async () => { nativeCalls++; return { state: 'owned', ownerPid: 123, ownerName: 'fixture.exe' }; };
  assert.equal((await manager.queryListenerOwnership(1443, '127.0.0.1', { serviceRunning: true })).state, 'owned');
  assert.equal(nativeCalls, 1);
});

test('unknown WinWS executable identity must never become owned solely because service runs', () => {
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path: path.win32, promisify: fn => fn, execFile: () => {},
    package_default: { version: '3.8.0' }, logger: { info() {}, warn() {} },
  }, ['ZapretManager']);
  const manager = new ZapretManager('resources', 'app', 'user', 'C:\\Fixture\\Zapret');
  assert.equal(manager.isOwnedWinwsProcess({ pid: 123, executablePath: '', commandLine: '' }, true), false);
});

test.after(() => console.log(JSON.stringify({ kind: 'inert-source-routing-check', commandCalls: calls, physicalOsQueries: false, scmMutations: false, networkMutations: false, nativeApiExecuted: false })));
