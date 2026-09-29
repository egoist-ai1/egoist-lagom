import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadComponentPins, loadBinaryPins, verifyPinnedBinary, verifyLicenseNotices, verifyExtractedComponent, copyAuthenticatedComponentFile } from '../scripts/prepare-components.mjs';

const exec = promisify(execFile);
const updaterSource = await fs.readFile(new URL('../src/recovered/electron/ipc/desktop-updater.js', import.meta.url), 'utf8');
const python = process.env.SHIELD_PYTHON || 'python';
const fixtureRoot = process.env.LAGOM_TEST_TEMP || os.tmpdir();

async function temporary(t, name) {
  const directory = await fs.mkdtemp(path.join(fixtureRoot, name));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const mode of ['redirect', 'content-length', 'metadata-write', 'file-open', 'reader-acquisition']) {
  test('update response and acquired file are released on early ' + mode + ' failure', async t => {
    const root = await temporary(t, 'updater-cleanup-');
    let cancellations = 0, closes = 0;
    const io = { ...fs };
    if (mode === 'metadata-write') io.writeFile = async () => { throw new Error('fixture disk write failed'); };
    if (mode === 'file-open') io.open = async () => { throw new Error('fixture disk open failed'); };
    if (mode === 'reader-acquisition') io.open = async () => ({ async close() { closes++; } });
    const context = vm.createContext({ path, promises: io, process, Buffer, URL, console, setTimeout, clearTimeout,
      fetchWithRetry: async () => ({ response: { url: mode === 'redirect' ? 'https://untrusted.invalid/setup.exe' : 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe', status: 200,
        headers: new Headers({ 'content-length': mode === 'content-length' ? '101' : '100' }),
        body: { async cancel() { cancellations++; }, getReader() { throw new Error('fixture reader acquisition failed'); } } } }) });
    vm.runInContext(updaterSource + '\nthis.DesktopUpdater = DesktopUpdater;', context);
    const updater = new context.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: root });
    await assert.rejects(updater.downloadCandidate({ version: '3.8.0', size: 100, assetUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe' }, path.join(root, 'updates/setup.partial')));
    assert.equal(cancellations, 1);
    assert.equal(closes, mode === 'reader-acquisition' ? 1 : 0);
  });
}

for (const code of ['signature-invalid', 'key-unknown', 'key-revoked', 'anti-rollback', 'manifest-invalid']) {
  test('REST trust failure ' + code + ' is preserved and cannot downgrade to stable fallback', async t => {
    const root = await temporary(t, 'updater-trust-failure-');
    let fallbackCalls = 0, userDataDir;
    const url = 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe';
    const context = vm.createContext({ path, promises: fs, process, Buffer, URL, console, setTimeout, clearTimeout,
      normalizeVersionTag: value => value.slice(1), compareLooseVersions: () => 1,
      fetchLatestGitHubRelease: async () => ({ tag_name: 'v3.8.0', assets: [{ name: 'EgoistShield-Setup-3.8.0.exe', browser_download_url: url }] }),
      verifyRemoteReleaseTrust: async options => { userDataDir = options.userDataDir; return { trustStatus: 'untrusted', failureCode: code, warnings: ['fixture trust rejected'] }; },
      verifyStableChannelTrust: async () => { fallbackCalls++; throw new Error('must not downgrade'); },
      getNetworkErrorDetails: () => ({ kind: 'unknown' }) });
    vm.runInContext(updaterSource + '\nthis.DesktopUpdater = DesktopUpdater;', context);
    const updater = new context.DesktopUpdater({ currentVersion: '3.7.9', userDataDir: root });
    const result = await updater.check();
    assert.equal(result.failureCode, code);
    assert.equal(result.phase, 'blocked');
    assert.equal(result.retryable, false);
    assert.equal(fallbackCalls, 0);
    assert.equal(userDataDir, root);
  });
}

test('bootstrap and packaging share the same immutable component descriptor', async () => {
  const pins = await loadComponentPins();
  assert.equal(pins.find(item => item.name === 'zapret').version, '1.10.3');
  const binaries = await loadBinaryPins();
  assert.equal(binaries[0].file, 'WinSW.NET461.exe');
  assert.equal(binaries[0].minimumFrameworkRelease, 528040);
  for (const name of ['download-component-candidates.py', 'download-wintun.py', 'prepare-components.mjs']) {
    const source = await fs.readFile(new URL('../scripts/' + name, import.meta.url), 'utf8');
    assert.ok(source.includes('component-inputs.json'), name + ' must consume the shared input descriptor');
  }
});

test('pinned wrapper binary authenticates ordinary bytes and rejects cache corruption', async t => {
  const root = await temporary(t, 'wrapper-input-');
  const bytes = Buffer.from('INERT fixture wrapper');
  const pin = { name: 'winsw', file: 'fixture.exe', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await fs.writeFile(path.join(root, pin.file), bytes);
  const verified = await verifyPinnedBinary(pin, root);
  assert.equal(verified.files[0].sha256, pin.sha256);
  await fs.writeFile(path.join(root, pin.file), Buffer.alloc(bytes.length));
  await assert.rejects(verifyPinnedBinary(pin, root), /Pinned binary input rejected/);
});

test('native license input detects modified notice bytes before package copy', async t => {
  const root = await temporary(t, 'license-input-');
  const bytes = Buffer.from('Fixture upstream notice');
  await fs.writeFile(path.join(root, 'LICENSE.txt'), bytes);
  const entry = { file: 'LICENSE.txt', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await fs.writeFile(path.join(root, 'sources.json'), JSON.stringify({ schemaVersion: 1, files: [entry] }));
  for (const name of ['native-components.json', 'source-inputs.json', 'SOURCE-DIRECTIONS.txt', 'sing-box-1.14.0-build-info.txt']) await fs.writeFile(path.join(root, name), 'INERT fixture metadata');
  assert.equal((await verifyLicenseNotices(root)).files.length, 6);
  await fs.writeFile(path.join(root, 'LICENSE.txt'), 'Changed fixture notice');
  await assert.rejects(verifyLicenseNotices(root), /Native license notice differs/);
});

const zipFixture = String.raw`import pathlib,zipfile,hashlib,json,sys
root=pathlib.Path(sys.argv[1]); mode=sys.argv[2]; cache=root/'candidates'; cache.mkdir()
archive=cache/'fixture.zip'; extracted=cache/'fixture'; (extracted/'bundle').mkdir(parents=True)
with zipfile.ZipFile(archive,'w',zipfile.ZIP_STORED) as z:
 z.writestr('bundle/runtime.exe',b'INERT fixture bytes')
 z.writestr('bundle/LICENSE',b'Fixture upstream license')
 if mode=='case-collision': z.writestr('bundle/license',b'Case alias')
 if mode=='escape': z.writestr('../escape.exe',b'INERT escape')
 if mode=='ads': z.writestr('bundle/runtime.exe:stream',b'INERT alternate stream')
(extracted/'bundle/runtime.exe').write_bytes(b'INERT changed bytes' if mode=='changed' else b'INERT fixture bytes')
(extracted/'bundle/LICENSE').write_bytes(b'Fixture upstream license')
if mode=='extra': (extracted/'bundle/unlisted.exe').write_bytes(b'INERT unlisted')
print(json.dumps({'name':'sing-box','version':'fixture','archive':'fixture.zip','rootDirectory':'bundle','sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}))`;

async function componentFixture(t, mode) {
  const root = await temporary(t, 'component-inventory-');
  const { stdout } = await exec(python, ['-c', zipFixture, root, mode], { windowsHide: true, timeout: 30000 });
  return { root, candidates: path.join(root, 'candidates'), pin: JSON.parse(stdout) };
}

test('authenticated component inventory includes original license bytes and accepts exact extracted files', async t => {
  const fixture = await componentFixture(t, 'valid');
  const result = await verifyExtractedComponent(fixture.pin, fixture.candidates);
  assert.deepEqual(result.files.map(item => item.path), ['bundle/LICENSE', 'bundle/runtime.exe']);
  const out = path.join(fixture.root, 'out');
  await fs.mkdir(out);
  await copyAuthenticatedComponentFile(result, result.files[0], path.join(out, 'LICENSE'), out);
  assert.equal(await fs.readFile(path.join(out, 'LICENSE'), 'utf8'), 'Fixture upstream license');
});

for (const mode of ['changed', 'extra', 'case-collision', 'escape', 'ads']) {
  test('component inventory rejects ' + mode + ' despite a correct archive hash', async t => {
    const fixture = await componentFixture(t, mode);
    await assert.rejects(verifyExtractedComponent(fixture.pin, fixture.candidates), /Component input rejected/);
  });
}

test('component copy rejects a changed source after its earlier successful authentication', async t => {
  const fixture = await componentFixture(t, 'valid');
  const result = await verifyExtractedComponent(fixture.pin, fixture.candidates);
  const entry = result.files.find(item => item.path === 'bundle/runtime.exe');
  await fs.writeFile(path.join(result.extracted, 'bundle/runtime.exe'), 'INERT later change');
  const out = path.join(fixture.root, 'out');
  await fs.mkdir(out);
  await assert.rejects(copyAuthenticatedComponentFile(result, entry, path.join(out, 'runtime.exe'), out), /changed after authentication/);
});

test('release source binding handles annotated tags and rejects changed commit, tree or target', async () => {
  const script = String.raw`import importlib.util,json,sys
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('release_source',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
commit='a'*40; tree='b'*40; annotation='c'*40; other='d'*40; repo='/repos/fixture/repo'; expected={'commit':commit,'tree':tree}; release={'tag_name':'v1.2.3','target_commitish':commit}
values={repo+'/git/commits/'+commit:{'sha':commit,'tree':{'sha':tree}},repo+'/git/ref/tags/v1.2.3':{'object':{'type':'tag','sha':annotation}},repo+'/git/tags/'+annotation:{'object':{'type':'commit','sha':commit}}}
def request(route):
 if route not in values: raise RuntimeError('GitHub API returned HTTP 404')
 return values[route]
assert module.verify_release_source(request,repo,release,expected)['tagCommit']==commit
assert module.verify_artifact_source({'source':expected},expected)==expected
try: module.verify_artifact_source({'source':{'commit':other,'tree':tree}},expected); raise AssertionError('artifact source mismatch accepted')
except RuntimeError: pass
try: module.verify_artifact_source({},expected); raise AssertionError('artifact without source accepted')
except RuntimeError: pass
results={'annotated-tag':'passed'}
values[repo+'/git/tags/'+annotation]['object']['sha']=other
try: module.verify_release_source(request,repo,release,expected); raise AssertionError('changed tag accepted')
except RuntimeError: results['changed-tag']='rejected'
del values[repo+'/git/ref/tags/v1.2.3']; release['target_commitish']='main'
try: module.verify_release_source(request,repo,release,expected,True); raise AssertionError('branch target accepted')
except RuntimeError: results['missing-tag-branch-target']='rejected'
release['target_commitish']=commit
assert module.verify_release_source(request,repo,release,expected,True)['tagCommit'] is None
results['uncreated-tag-exact-commit']='passed'
values[repo+'/git/commits/'+commit]['tree']['sha']=other
try: module.verify_release_source(request,repo,release,expected,True); raise AssertionError('changed tree accepted')
except RuntimeError: results['changed-tree']='rejected'
print(json.dumps(results))`;
  const { stdout } = await exec(python, ['-c', script, fileURLToPath(new URL('../scripts/release-source.py', import.meta.url))], { windowsHide: true, timeout: 30000 });
  const result = JSON.parse(stdout);
  assert.equal(result['annotated-tag'], 'passed');
  assert.equal(result['changed-tag'], 'rejected');
  assert.equal(result['missing-tag-branch-target'], 'rejected');
  assert.equal(result['uncreated-tag-exact-commit'], 'passed');
  assert.equal(result['changed-tree'], 'rejected');
});

test('native-source tool authenticates Go h1 fixture, rejects changed bytes and validates preserved source links', async t => {
  const root = await temporary(t, 'native-source-');
  const script = String.raw`import pathlib,zipfile,hashlib,base64,importlib.util,sys,stat,json
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('native_sources',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=pathlib.Path(sys.argv[2]);target=root/'module.zip';name='fixture.org/library@v1.0.0/LICENSE';data=b'INERT upstream notice'
with zipfile.ZipFile(target,'w') as z:z.writestr(name,data)
expected='h1:'+base64.b64encode(hashlib.sha256((hashlib.sha256(data).hexdigest()+'  '+name+'\n').encode()).digest()).decode()
assert module.module_h1(target,'fixture.org/library','v1.0.0')==expected
pin={'module':'fixture.org/library','version':'v1.0.0','h1':expected};module.verify(target,pin)
with zipfile.ZipFile(target,'w') as z:z.writestr(name,b'INERT changed notice')
try:module.verify(target,pin);raise AssertionError('changed module accepted')
except ValueError:pass
for linkTarget,allowed in [('file.txt',True),('../../escape',False)]:
 with zipfile.ZipFile(target,'w') as z:
  info=zipfile.ZipInfo('upstream/link');info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(info,linkTarget)
 with zipfile.ZipFile(target) as z:
  try:module.source_entries(z,preserve_source_links=True);assert allowed
  except ValueError:assert not allowed
print(json.dumps({'h1':'verified','changed':'rejected','source-link':'preserved','escaping-link':'rejected'}))`;
  const { stdout } = await exec(python, ['-c', script, fileURLToPath(new URL('../scripts/prepare-native-sources.py', import.meta.url)), root], { windowsHide: true, timeout: 30000 });
  assert.equal(JSON.parse(stdout).h1, 'verified');
});
