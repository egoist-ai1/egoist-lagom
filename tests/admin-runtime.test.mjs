import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const RESOURCES_PATH = path.join('C:', 'EgoistShield', 'resources');
const HELPER_PATH = path.join(RESOURCES_PATH, 'core-service', 'win-x64', 'EgoistShield.Service.exe');

class RuntimeInstaller {
  constructor() {}
}

class KillSwitch {
  isActive() { return false; }
}

function loadManager({ helperExists = true, helperResponses = [] } = {}) {
  const calls = [];
  const { VpnRuntimeManager } = loadRecovered('electron/ipc/vpn-manager', {
    EventEmitter,
    RuntimeInstaller,
    KillSwitch,
    path,
    fs: { existsSync: candidate => helperExists && candidate === HELPER_PATH },
    process: { platform: 'win32', env: {} },
    execFile: async () => { throw new Error('No custom executable should discover process privilege'); },
    checkNativeExecutionPrivilege: async () => {
      calls.push({ tokenCheck: true });
      if (!helperExists) throw new Error('Protected token check unavailable');
      const response = helperResponses.shift();
      if (response instanceof Error) throw response;
      const result = JSON.parse(response?.stdout ?? '{"ok":true,"isAdmin":true}');
      if (result.ok !== true) throw new Error('Token observation failed');
      return result.isAdmin;
    },
    promisify: fn => fn,
  }, ['VpnRuntimeManager']);
  return { manager: new VpnRuntimeManager(RESOURCES_PATH, 'C:/user-data'), calls };
}

test('a validated process token check does not depend on net.exe session availability', async () => {
  const { manager, calls } = loadManager({ helperResponses: [{ stdout: '{"ok":true,"isAdmin":true}' }] });

  assert.equal(await manager.isAdmin(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tokenCheck, true);
});

test('a validated ordinary-user result is cached', async () => {
  const { manager, calls } = loadManager({ helperResponses: [{ stdout: '{"ok":true,"isAdmin":false}' }] });

  assert.equal(await manager.isAdmin(), false);
  assert.equal(await manager.isAdmin(), false);
  assert.equal(calls.length, 1);
});

test('a transient native checker failure fails closed without poisoning the admin cache', async () => {
  const { manager, calls } = loadManager({ helperResponses: [new Error('cold runtime timeout'), { stdout: '{"ok":true,"isAdmin":true}' }] });

  await assert.rejects(manager.isAdmin(), /Не удалось подтвердить привилегии/);
  assert.equal(await manager.isAdmin(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.tokenCheck === true), true);
});
test('an unavailable native checker remains unknown rather than declaring an ordinary user', async () => {
  const { manager, calls } = loadManager({ helperExists: false });
  await assert.rejects(manager.isAdmin(), /Не удалось подтвердить привилегии/);
  assert.equal(manager.cachedIsAdmin, null);
  assert.equal(calls.length, 1);
});
test('malformed token result never poisons the privilege cache', async () => {
  const { manager } = loadManager({ helperResponses: [{ stdout: '{"ok":true,"isAdmin":"false"}' }] });
  await assert.rejects(manager.isAdmin(), /Не удалось подтвердить привилегии/);
  assert.equal(manager.cachedIsAdmin, null);
});

test('native admin CLI checks the current Windows token before service initialization', () => {
  const program = fs.readFileSync('src/service/EgoistShield.Service/Program.cs', 'utf8');
  const checker = fs.readFileSync('src/service/EgoistShield.Service/AdminStatusChecker.cs', 'utf8');

  assert.match(program, /--check-admin/);
  assert.match(program, /AdminStatusChecker\.Check\(\)/);
  assert.ok(program.indexOf('parsed.CheckAdmin') < program.indexOf('string stateRoot = parsed.StateRoot'));
  assert.match(checker, /WindowsIdentity\.GetCurrent\(\)/);
  assert.match(checker, /WindowsBuiltInRole\.Administrator/);
});
