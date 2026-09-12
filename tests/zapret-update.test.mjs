import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { loadRecovered } from './load-recovered.mjs';

async function fixture(t, fault) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-zapret-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const work = path.join(root, 'work');
  await fs.mkdir(path.join(work, 'core/bin'), { recursive: true });
  await fs.mkdir(path.join(work, 'core/lists'), { recursive: true });
  await fs.writeFile(path.join(work, 'core/bin/winws.exe'), 'old');
  await fs.writeFile(path.join(work, 'core/service.bat'), 'old');
  await fs.writeFile(path.join(work, 'core/lists/list-general-user.txt'), 'personal.example');
  await fs.writeFile(path.join(work, 'VERSION.txt'), 'v1');
  const events = [];
  let failOnce = true;
  const { ZapretManager } = loadRecovered('electron/ipc/zapret-manager', {
    path, promisify, execFile, package_default: { version: '3.6.0' },
    promises: { ...fs, async rename(from, to) {
      if (fault === 'publish' && failOnce && from.includes('candidate') && to === path.join(work, 'core')) {
        failOnce = false; throw new Error('Publish failure');
      }
      return fs.rename(from, to);
    } },
    logger: { info(){}, warn(){} },
    normalizeVersionTag: value => value?.replace(/^v/, '').trim(),
    compareLooseVersions: (a,b) => a.localeCompare(b),
    pickGitHubAsset: () => ({ name: 'core.zip', browser_download_url: 'https://example.test/core.zip' }),
    downloadFileWithProgress: async () => { events.push('download'); if (fault === 'download') throw new Error('Offline'); },
    verifyGitHubReleaseAssetChecksum: async () => ({ verified: true, integritySource: 'test' }),
    extractZipArchive: async (_, dest) => {
      await fs.mkdir(path.join(dest, 'bin'), { recursive: true });
      await fs.writeFile(path.join(dest, 'bin/winws.exe'), 'new');
      await fs.writeFile(path.join(dest, 'service.bat'), 'new');
    },
  }, ['ZapretManager']);
  const manager = new ZapretManager(root, root, root, work, null);
  manager.resolveFlowsealInstallTarget = async () => ({ version: 'v2', release: {} });
  manager.readCoreVersion = () => fs.readFile(path.join(work, 'VERSION.txt'), 'utf8');
  manager.status = async () => ({ serviceRunning: true, currentProfile: 'General' });
  manager.stopServiceInternal = async () => events.push('stop');
  manager.stopStandaloneInternal = async () => events.push('stop-standalone');
  manager.startService = async () => events.push('start');
  manager.prepareCoreFilesForUpdate = async () => {};
  manager.findFlowsealPayloadRoot = async dir => ({ layout: 'core', sourceDir: dir });
  manager.applyFlowsealScriptFixes = async () => {};
  manager.writeEffectiveIpsetList = async () => {};
  manager.writeInstalledCoreVersion = value => fs.writeFile(path.join(work, 'VERSION.txt'), value);
  return { manager, work, events };
}

test('Zapret download failure leaves the running service untouched', async t => {
  const { manager, events, work } = await fixture(t, 'download');
  await assert.rejects(manager.installCoreUpdate(), /Offline/);
  assert.deepEqual(events, ['download']);
  assert.equal(await fs.readFile(path.join(work, 'core/bin/winws.exe'), 'utf8'), 'old');
});
test('Zapret failed publication restores files and restarts the prior service', async t => {
  const { manager, events, work } = await fixture(t, 'publish');
  await assert.rejects(manager.installCoreUpdate(), /Publish failure/);
  assert.deepEqual(events, ['download', 'stop', 'start']);
  assert.equal(await fs.readFile(path.join(work, 'core/bin/winws.exe'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(work, 'VERSION.txt'), 'utf8'), 'v1');
});
test('Zapret successful update preserves user lists and only stops after download', async t => {
  const { manager, events, work } = await fixture(t);
  await manager.installCoreUpdate();
  assert.deepEqual(events, ['download', 'stop', 'start']);
  assert.equal(await fs.readFile(path.join(work, 'core/bin/winws.exe'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(work, 'core/lists/list-general-user.txt'), 'utf8'), 'personal.example');
});
test('Zapret recovers a crash between moving the prior core and publishing the candidate', async t => {
  const {manager,work,events}=await fixture(t);
  await fs.rename(path.join(work,'core'),path.join(work,'core.previous'));
  await fs.writeFile(path.join(work,'core-update.json'),JSON.stringify({schema:1,phase:'prepared',previousVersion:'v1',targetVersion:'v2'}));
  await manager.recoverInterruptedCoreUpdate();
  assert.equal(await fs.readFile(path.join(work,'core/bin/winws.exe'),'utf8'),'old');
  assert.equal(await fs.readFile(path.join(work,'VERSION.txt'),'utf8'),'v1');
  assert.ok(!events.includes('start'),'Recovery must not enable network services');
});
test('Zapret provisioning does not overwrite an existing core when the bundle is newer',async t=>{
  const {manager,work}=await fixture(t);
  await fs.mkdir(path.join(work,'service'),{recursive:true});
  manager.pathExists=async file=>file.endsWith('service.bat')||file.endsWith('.exe');
  manager.getSourceRuntimeInfo=async()=>({sourceDir:'unused',version:'v99'});
  manager.copyRuntimeTree=async()=>{throw Error('Must not refresh a live runtime in place')};
  manager.ensureUserLists=async()=>{};
  await manager.ensureProvisioned();
});
