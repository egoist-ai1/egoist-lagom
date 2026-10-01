import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPinnedElectronRuntime, stageElectronPayload, addElectronToRuntimeManifest, sha256File, verifyPackagedInstallHealth } from '../scripts/electron-runtime.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.SHIELD_PYTHON || 'python';
const work = process.env.EGOIST_PACKAGING_TEST_DIR || process.env.SHIELD_EVIDENCE_DIR;
const isolated = { skip: !work || !path.isAbsolute(work) ? 'Set EGOIST_PACKAGING_TEST_DIR to this task work directory.' : false };
const fixtureScript = String.raw`import sys, pathlib, json, hashlib, zipfile, shutil, stat
sys.dont_write_bytecode = True
root=pathlib.Path(sys.argv[1]); original=pathlib.Path(sys.argv[2]); mode=sys.argv[3]
pin=json.loads((original/'scripts/electron-runtime.json').read_text(encoding='utf-8'))
cache=root/'.tools'/('electron-'+pin['version']); runtime=cache/'runtime'; runtime.mkdir(parents=True)
payload={name:('fresh-runtime:'+name).encode('ascii') for name in pin['requiredFiles']}
payload['version']=pin['version'].encode('ascii') if mode!='wrong-version' else b'41.10.4'
payload['resources/default_app.asar']=b'upstream sample only'
payload['electron.exe'] += b'\0'*(1024*1024)
archive=cache/pin['asset']['name']
with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as z:
 for name,body in payload.items():z.writestr(name,body)
 if mode=='unsafe':z.writestr('../escape.dll',b'bad')
 if mode=='case-collision':z.writestr('license',b'bad')
 if mode=='symlink':
  entry=zipfile.ZipInfo('link.dll'); entry.create_system=3; entry.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(entry,b'electron.exe')
for name,body in payload.items():
 target=runtime.joinpath(*name.split('/')); target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(body)
sha=hashlib.sha256(archive.read_bytes()).hexdigest(); pin['asset']['sha256']=sha; pin['asset']['bytes']=archive.stat().st_size
sums=(sha+' *'+pin['asset']['name']+'\n').encode('ascii'); (cache/'SHASUMS256.txt').write_bytes(sums); pin['shasums']['sha256']=hashlib.sha256(sums).hexdigest(); pin['shasums']['bytes']=len(sums)
metadata={'id':pin['releaseId'],'tag_name':'v'+pin['version'],'published_at':pin['publishedAt'],'draft':False,'prerelease':False,'assets':[{'id':v['id'],'name':v['name'],'size':v['bytes'],'digest':'sha256:'+v['sha256'],'browser_download_url':v['url']} for v in [pin['asset'],pin['shasums']]]}
(cache/'official-release.json').write_text(json.dumps(metadata),encoding='utf-8')
(root/'scripts').mkdir(); (root/'scripts/electron-runtime.json').write_text(json.dumps(pin),encoding='utf-8'); shutil.copyfile(original/'scripts/fetch-electron-runtime.py',root/'scripts/fetch-electron-runtime.py')
print(json.dumps({'cache':str(cache),'runtime':str(runtime)}))`;

async function fixture(mode = 'valid') {
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, 'electron-packaging-test-'));
  const generator = path.join(directory, 'create-fixture.py');
  await fs.writeFile(generator, fixtureScript);
  const result = await exec(python, [generator, directory, root, mode], { windowsHide: true, timeout: 30000 });
  return { root: directory, ...JSON.parse(result.stdout), async close() { await fs.rm(directory, { recursive: true, force: true }); } };
}

test('official Electron pin records identical archive digest and immutable release sources', async () => {
  const pin = JSON.parse(await fs.readFile(path.join(root, 'scripts/electron-runtime.json'), 'utf8'));
  assert.equal(pin.version, '44.5.1');
  assert.equal(pin.platform, 'win32');
  assert.equal(pin.arch, 'x64');
  assert.equal(pin.asset.sha256, '9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db');
  assert.equal(pin.asset.bytes, 157998329);
  assert.equal(pin.shasums.sha256, '8cfa7460b2aaac1812bfeed3c6957d14ad384b9f31ae0407ba5e64bb6b43ec3e');
});

test('offline verification authenticates every extracted runtime file against the pinned ZIP', isolated, async () => {
  const f = await fixture();
  try {
    const runtime = await verifyPinnedElectronRuntime(f.root, { python });
    assert.equal(runtime.version, '44.5.1');
    assert.equal(runtime.files.find(entry => entry.path === 'electron.exe').sha256, await sha256File(path.join(f.runtime, 'electron.exe')));
    assert.ok(runtime.integritySources.includes('official GitHub asset.digest'));
    assert.ok(runtime.files.some(entry => entry.path === 'locales/ru.pak'));
  } finally { await f.close(); }
});

for (const [name, mutate, expected] of [
  ['corrupt archive', async f => fs.appendFile(path.join(f.cache, 'electron-v44.5.1-win32-x64.zip'), 'corrupt'), /archive checksum mismatch/],
  ['modified extracted DLL', async f => fs.writeFile(path.join(f.runtime, 'ffmpeg.dll'), 'modified'), /runtime checksum mismatch/],
  ['injected stale DLL', async f => fs.writeFile(path.join(f.runtime, 'libEGL.dll'), 'stale runtime'), /runtime file set mismatch/],
  ['missing runtime locale', async f => fs.rm(path.join(f.runtime, 'locales/ru.pak')), /runtime file set mismatch/],
  ['altered official checksum file', async f => fs.appendFile(path.join(f.cache, 'SHASUMS256.txt'), 'extra'), /SHASUMS256 checksum mismatch/],
  ['inconsistent GitHub asset digest', async f => {
    const file = path.join(f.cache, 'official-release.json');
    const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    metadata.assets[0].digest = 'sha256:' + '0'.repeat(64);
    await fs.writeFile(file, JSON.stringify(metadata));
  }, /asset.digest\/identity mismatch/],
  ['inconsistent publication date', async f => {
    const file = path.join(f.cache, 'official-release.json');
    const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    metadata.published_at = '2026-09-24T00:00:00Z';
    await fs.writeFile(file, JSON.stringify(metadata));
  }, /release identity mismatch/],
  ['oversized checksum file', async f => fs.writeFile(path.join(f.cache, 'SHASUMS256.txt'), Buffer.alloc(2 * 1024 * 1024 + 1)), /SHASUMS256 checksum mismatch/]
]) {
  test('offline cache rejects ' + name, isolated, async () => {
    const f = await fixture();
    try { await mutate(f); await assert.rejects(verifyPinnedElectronRuntime(f.root, { python }), expected); }
    finally { await f.close(); }
  });
}

for (const [mode, expected] of [['unsafe', /Unsafe ZIP path/], ['case-collision', /Duplicate\/colliding/], ['symlink', /Linked\/encrypted/], ['wrong-version', /archive version mismatch/]]) {
  test('runtime ZIP rejects ' + mode + ' before staging', isolated, async () => {
    const f = await fixture(mode);
    try { await assert.rejects(verifyPinnedElectronRuntime(f.root, { python }), expected); }
    finally { await f.close(); }
  });
}

async function productFixture(f) {
  const resources = path.join(f.root, 'recovered/resources');
  for (const [relative, body] of [
    ['brand/icon.ico', 'product icon'], ['runtime/manifest.json', JSON.stringify({ schemaVersion: 1, packageVersion: '3.7.9', components: [{ name: 'xray', version: '26.5.3' }] })],
    ['core-service/old.dll', 'retired Core'], ['app.asar', 'retired product ASAR'], ['elevate.exe', 'product helper'],
    ['scripts/system-control/old.ps1', 'retired script'], ['scripts/product-script.ps1', 'retained script']
  ]) {
    const file = path.join(resources, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
  await fs.writeFile(path.join(f.root, 'recovered/libEGL.dll'), 'retired Electron DLL');
  const components = [];
  for (const name of ['xray', 'sing-box', 'zapret', 'tg-ws-proxy']) {
    const relative = `${name}/fixture.bin`;
    const file = path.join(resources, 'runtime', ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, name);
    components.push({ name, version: 'fixture', present: true, fileCount: 1, files: [{ path: relative, size: (await fs.stat(file)).size, sha256: await sha256File(file) }] });
  }
  const profiles = path.join(resources, 'runtime/zapret/core');
  await fs.mkdir(profiles, { recursive: true });
  for (let index = 0; index < 10; index++) await fs.writeFile(path.join(profiles, `profile-${index}.bat`), '@echo off');
  await fs.writeFile(path.join(resources, 'runtime/manifest.json'), JSON.stringify({ schemaVersion: 1, packageVersion: '3.7.9', components }));
  return resources;
}

async function assertInstallerHealth(out) {
  for (const relative of ['resources/app.asar', 'resources/component-worker.cjs', 'resources/core-service/win-x64/EgoistShield.Service.exe', 'resources/gravityless-dns/dnscrypt-proxy.exe', 'resources/gravityless-dns/dnscrypt-proxy.toml', 'resources/installer/owned-cleanup.ps1']) {
    const file = path.join(out, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'fresh product fixture');
  }
  const result = await verifyPackagedInstallHealth(out);
  assert.equal(result.healthy, true);
  assert.equal(result.root, out);
  assert.equal(result.sourceSha256, await sha256File(path.join(root, 'src/installer/owned-cleanup.ps1')));
  assert.equal((await verifyPackagedInstallHealth(path.relative(process.cwd(), out))).healthy, true);
}

test('staging uses all new runtime files and product resources without old runtime DLLs, ASAR or Core', isolated, async () => {
  const f = await fixture();
  try {
    const runtime = await verifyPinnedElectronRuntime(f.root, { python });
    const resources = await productFixture(f);
    const out = path.join(f.root, 'out/new');
    const staged = await stageElectronPayload({ runtime, out, recoveredResources: resources });
    assert.equal(await fs.readFile(path.join(out, 'LICENSE'), 'utf8'), 'fresh-runtime:LICENSE');
    assert.equal(await fs.readFile(path.join(out, 'version'), 'utf8'), '44.5.1');
    assert.equal(await fs.readFile(path.join(out, 'resources/brand/icon.ico'), 'utf8'), 'product icon');
    for (const relative of ['electron.exe', 'libEGL.dll', 'resources/default_app.asar', 'resources/app.asar', 'resources/core-service/old.dll', 'resources/scripts/system-control/old.ps1', 'resources/elevate.exe']) assert.equal(await fs.stat(path.join(out, ...relative.split('/'))).catch(() => null), null, relative);
    assert.equal(await fs.readFile(path.join(out, 'resources/scripts/product-script.ps1'), 'utf8'), 'retained script');
    await fs.appendFile(path.join(out, 'EgoistShield.exe'), '-product-branding');
    const receipt = await addElectronToRuntimeManifest(out, staged);
    const component = JSON.parse(await fs.readFile(path.join(out, 'resources/runtime/manifest.json'), 'utf8')).components.find(entry => entry.name === 'electron');
    assert.equal(component.version, '44.5.1');
    assert.equal(component.upstream.repositoryUrl, 'https://github.com/electron/electron');
    assert.equal(component.autoApplyAllowed, false);
    assert.equal(component.fileCount, 1);
    assert.deepEqual(component.files.map(entry => entry.path), ['electron/provenance.json']);
    assert.equal(receipt.provenancePath, 'resources/runtime/electron/provenance.json');
    assert.equal(component.files[0].sha256, await sha256File(path.join(out, ...receipt.provenancePath.split('/'))));
    assert.equal(await fs.stat(path.join(out, 'resources/electron-runtime-provenance.json')).catch(() => null), null);
    assert.equal(JSON.parse(await fs.readFile(path.join(out, ...receipt.provenancePath.split('/')), 'utf8')).version, '44.5.1');
    assert.equal(receipt.runtimeFiles.find(entry => entry.path === 'EgoistShield.exe').upstreamSha256, runtime.files.find(entry => entry.path === 'electron.exe').sha256);
    assert.equal(receipt.runtimeFiles.find(entry => entry.path === 'EgoistShield.exe').sha256, await sha256File(path.join(out, 'EgoistShield.exe')));
    await assertInstallerHealth(out);
    const manifestFile = path.join(out, 'resources/runtime/manifest.json');
    const validManifest = await fs.readFile(manifestFile, 'utf8');
    const invalidManifest = JSON.parse(validManifest);
    invalidManifest.components.find(entry => entry.name === 'electron').files[0].path = '../../version';
    await fs.writeFile(manifestFile, JSON.stringify(invalidManifest));
    await assert.rejects(verifyPackagedInstallHealth(out), /runtime path escapes the package root/);
    await fs.writeFile(manifestFile, validManifest);
    await fs.appendFile(path.join(out, 'ffmpeg.dll'), 'unexpected');
    await assert.rejects(addElectronToRuntimeManifest(out, staged), /changed while packaging/);
  } finally { await f.close(); }
});

test('staging rejects an injected runtime file even after an earlier successful verification', isolated, async () => {
  const f = await fixture();
  try {
    const runtime = await verifyPinnedElectronRuntime(f.root, { python });
    const resources = await productFixture(f);
    await fs.writeFile(path.join(f.runtime, 'obsolete.dll'), 'injected');
    await assert.rejects(stageElectronPayload({ runtime, out: path.join(f.root, 'out/new'), recoveredResources: resources }), /file set changed before staging/);
  } finally { await f.close(); }
});

test('production packaging verifies the pin before replacing output and embeds runtime/ordinary GUI/version provenance', async () => {
  const source = await fs.readFile(path.join(root, 'scripts/package-windows.mjs'), 'utf8');
  assert.ok(source.indexOf('const electronRuntime = await verifyPinnedElectronRuntime(root)') < source.indexOf('await fs.rm(out,'));
  assert.doesNotMatch(source, /fs\.cp\(recoveredApp, out/);
  assert.match(source, /'requested-execution-level': 'asInvoker'/);
  assert.match(source, /electronRuntime: packagedElectron/);
  assert.match(source, /packagedElectron\.runtimeFiles\.map/);
  assert.match(source, /resources\/runtime\/electron\/provenance\.json/);
  const healthGate = source.indexOf('const installHealth = await verifyPackagedInstallHealth(out)');
  assert.ok(healthGate > source.indexOf("if (publish.status !== 0) throw new Error('Core publish failed"));
  assert.ok(healthGate < source.indexOf('const installerCode = await new Promise'));
  assert.match(source, /install-health-preflight\.json/);
});
