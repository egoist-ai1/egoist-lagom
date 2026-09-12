import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadRecovered } from './load-recovered.mjs';

async function fixture(t, fault) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-runtime-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'runtime/xray');
  await fs.mkdir(target, { recursive: true });
  for (const file of ['xray.exe', 'geoip.dat', 'geosite.dat', 'wintun.dll', 'WINTUN-LICENSE.txt']) await fs.writeFile(path.join(target, file), `old-${file}`);
  await fs.writeFile(path.join(target, 'VERSION.txt'), 'v1');
  let failOnce = true;
  const promises = { ...fs,
    async copyFile(from, to, ...args) {
      if (fault === 'copy' && failOnce && from.includes('extract') && from.endsWith('geosite.dat')) { failOnce = false; throw new Error('Disk write failed'); }
      return fs.copyFile(from, to, ...args);
    },
    async rename(from, to) {
      if (fault === 'publish' && failOnce && from.includes('.candidate-') && to === target) { failOnce = false; throw new Error('Candidate publish failed'); }
      return fs.rename(from, to);
    },
  };
  const { RuntimeInstaller, XRAY_PLAN } = loadRecovered('electron/ipc/runtime-installer', {
    promises, path, randomUUID, readVersionFile: async file => fs.readFile(file, 'utf8').then(x => x.trim()).catch(() => null),
    normalizeVersionTag: x => x, compareLooseVersions: (a,b) => a.localeCompare(b),
    resolveLatestGitHubRelease: async () => ({ tag_name: fault === 'recovery' ? 'v1' : fault === 'stale' ? 'v0' : 'v2', release: { assets: [] } }),
    pickGitHubAsset: () => ({ name: 'xray.zip', browser_download_url: 'https://github.com/XTLS/Xray-core/releases/download/v2/xray.zip' }),
    downloadFileWithProgress: async () => { if (fault === 'recovery') throw new Error('Offline'); },
    verifyGitHubReleaseAssetChecksum: async () => ({ verified: true }),
    extractZipArchive: async (_, dir) => {
      await fs.mkdir(dir, { recursive: true });
      for (const file of ['xray.exe','geoip.dat','geosite.dat']) await fs.writeFile(path.join(dir, file), `new-${file}`);
    },
  }, ['RuntimeInstaller','XRAY_PLAN']);
  const installer = new RuntimeInstaller(root, root);
  installer.readBundledVersion = async () => null;
  installer.findBundledRuntimeDir = async () => null;
  installer.validateRuntimeExecutable = async () => {};
  return { root, target, installer, plan: XRAY_PLAN };
}
test('failed runtime data copy preserves the entire old executable and data set', async t => {
  const { target, installer, plan } = await fixture(t, 'copy');
  const result = await installer.installRuntime(plan);
  assert.equal(result.updated, false);
  for (const file of ['xray.exe','geoip.dat','geosite.dat']) assert.equal(await fs.readFile(path.join(target, file), 'utf8'), `old-${file}`);
  assert.equal(await fs.readFile(path.join(target, 'VERSION.txt'), 'utf8'), 'v1');
});
test('failed directory publication restores the previous complete runtime', async t => {
  const { target, installer, plan } = await fixture(t, 'publish');
  const result = await installer.installRuntime(plan);
  assert.equal(result.updated, false);
  assert.equal(await fs.readFile(path.join(target, 'xray.exe'), 'utf8'), 'old-xray.exe');
});

test('runtime update preserves the signed TUN dependency when upstream omits it', async t => {
  const {target,installer,plan}=await fixture(t);
  const result=await installer.installRuntime(plan);
  assert.equal(result.updated,true);
  assert.equal(await fs.readFile(path.join(target,'xray.exe'),'utf8'),'new-xray.exe');
  assert.equal(await fs.readFile(path.join(target,'wintun.dll'),'utf8'),'old-wintun.dll');
  assert.equal(await fs.readFile(path.join(target,'WINTUN-LICENSE.txt'),'utf8'),'old-WINTUN-LICENSE.txt');
});

test('legacy runtime update obtains missing TUN dependency from the installed bundle', async t => {
  const {root,target,installer,plan}=await fixture(t);
  const bundled=path.join(root,'bundled-xray');
  await fs.mkdir(bundled);
  for(const file of ['wintun.dll','WINTUN-LICENSE.txt']){
    await fs.unlink(path.join(target,file));
    await fs.writeFile(path.join(bundled,file),'bundled-'+file);
  }
  installer.findBundledRuntimeDir=async()=>bundled;
  const result=await installer.installRuntime(plan);
  assert.equal(result.updated,true);
  assert.equal(await fs.readFile(path.join(target,'wintun.dll'),'utf8'),'bundled-wintun.dll');
});
test('interrupted runtime publication recovers offline from the previous directory', async t => {
  const { target, installer, plan } = await fixture(t, 'recovery');
  await fs.rename(target, `${target}.previous`);
  const result = await installer.installRuntime(plan);
  assert.equal(result.ok, true);
  assert.equal(result.version, 'v1');
  assert.equal(await fs.readFile(path.join(target, 'xray.exe'), 'utf8'), 'old-xray.exe');
});

test('stale latest-release metadata never downgrades the installed runtime', async t => {
  const { target, installer, plan } = await fixture(t, 'stale');
  const result = await installer.installRuntime(plan);
  assert.equal(result.updated, false);
  assert.equal(result.version, 'v1');
  assert.match(result.message, /v1/);
  assert.equal(await fs.readFile(path.join(target, 'xray.exe'), 'utf8'), 'old-xray.exe');
});
