import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { loadRecovered } from './load-recovered.mjs';

class RuntimeInstaller {
  constructor() {}
}

class KillSwitch {
  isActive() { return false; }
}

const { VpnRuntimeManager } = loadRecovered('electron/ipc/vpn-manager', {
  EventEmitter,
  promisify,
  execFile: () => {},
  RuntimeInstaller,
  KillSwitch,
  path,
  promises: fs,
  process,
  XRAY_NATIVE_TUN_MIN_VERSION: 'v26.5.3',
  XRAY_PLAN: { exeName: 'xray.exe' },
  readVersionFile: async file => fs.readFile(file, 'utf8').then(value => value.trim()).catch(() => null),
  compareLooseVersions: (left, right) => left.localeCompare(right, undefined, { numeric: true }),
}, ['VpnRuntimeManager']);

test('native TUN replaces an incomplete managed Xray selected ahead of the bundle', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-vpn-runtime-selection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyRuntime = path.join(root, 'runtime/xray/xray.exe');
  const trustedRuntime = path.join(root, 'trusted/xray.exe');
  await fs.mkdir(path.dirname(legacyRuntime), { recursive: true });
  await fs.mkdir(path.dirname(trustedRuntime), { recursive: true });
  await fs.writeFile(legacyRuntime, 'legacy');
  await fs.writeFile(path.join(path.dirname(legacyRuntime), 'VERSION.txt'), 'v26.4.0');
  await fs.writeFile(trustedRuntime, 'trusted');
  await fs.writeFile(path.join(path.dirname(trustedRuntime), 'VERSION.txt'), 'v26.5.3');
  await fs.writeFile(path.join(path.dirname(trustedRuntime), 'wintun.dll'), 'trusted-wintun');
  const manager = new VpnRuntimeManager(root, root);
  manager.installer.findBundledRuntimeDir = async () => path.dirname(trustedRuntime);
  const initiallySelected = await manager.resolveRuntimePath('', 'xray', false);
  assert.equal(initiallySelected.runtimePath, legacyRuntime);
  const selectedForTun = await manager.resolveXrayTunRuntime('', initiallySelected);
  assert.equal(selectedForTun.ok, true);
  assert.equal(selectedForTun.runtime.runtimePath, trustedRuntime);
  assert.equal(await fs.readFile(legacyRuntime, 'utf8'), 'legacy');
  assert.equal(await fs.readFile(path.join(path.dirname(legacyRuntime), 'VERSION.txt'), 'utf8'), 'v26.4.0');
});

test('custom Xray without Wintun is rejected instead of being overwritten', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-vpn-custom-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const customRuntime = path.join(root, 'custom/xray.exe');
  await fs.mkdir(path.dirname(customRuntime), { recursive: true });
  await fs.writeFile(customRuntime, 'custom');
  const manager = new VpnRuntimeManager(root, root);
  let bundledLookup = false;
  manager.installer.findBundledRuntimeDir = async () => { bundledLookup = true; return null; };
  const result = await manager.resolveXrayTunRuntime(customRuntime, { runtimeKind: 'xray', runtimePath: customRuntime });
  assert.equal(result.ok, false);
  assert.match(result.message, /wintun\.dll/i);
  assert.equal(bundledLookup, false);
});

test('an invalid configured Xray path falls back to a ready bundled TUN runtime', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-vpn-fallback-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const managedRuntime = path.join(root, 'runtime/xray/xray.exe');
  const bundledRuntime = path.join(root, 'bundled/xray.exe');
  await fs.mkdir(path.dirname(managedRuntime), { recursive: true });
  await fs.mkdir(path.dirname(bundledRuntime), { recursive: true });
  await fs.writeFile(managedRuntime, 'legacy');
  await fs.writeFile(path.join(path.dirname(managedRuntime), 'VERSION.txt'), 'v26.4.0');
  await fs.writeFile(bundledRuntime, 'trusted');
  await fs.writeFile(path.join(path.dirname(bundledRuntime), 'VERSION.txt'), 'v26.5.3');
  await fs.writeFile(path.join(path.dirname(bundledRuntime), 'wintun.dll'), 'trusted-wintun');
  const manager = new VpnRuntimeManager(root, root);
  manager.installer.findBundledRuntimeDir = async () => path.dirname(bundledRuntime);
  const invalidCustomPath = path.join(root, 'missing/xray.exe');
  const initiallySelected = await manager.resolveRuntimePath(invalidCustomPath, 'xray', false);
  assert.equal(initiallySelected.runtimePath, managedRuntime);
  const selectedForTun = await manager.resolveXrayTunRuntime(invalidCustomPath, initiallySelected);
  assert.equal(selectedForTun.ok, true);
  assert.equal(selectedForTun.runtime.runtimePath, bundledRuntime);
});
