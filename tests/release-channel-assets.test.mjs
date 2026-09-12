import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareReleaseAssets } from '../scripts/prepare-release-assets.mjs';
import { bootstrapReleaseTrust } from '../scripts/bootstrap-release-trust.mjs';

const pair = () => generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(process.env.EGOIST_RELEASE_TEST_DIR ?? os.tmpdir(), 'release-channel-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const dist = path.join(base, 'dist');
  const trust = path.join(base, 'resources/release');
  const runtime = path.join(base, 'runtime');
  await Promise.all([dist, trust, runtime].map(dir => fs.mkdir(dir, { recursive: true })));
  const root = pair(), release = pair(), wrong = pair();
  const registry = Buffer.from(JSON.stringify({ schemaVersion: 1, generatedAt: '2026-09-12T00:00:00Z', keys: [{ id: 'fixture-release', algorithm: 'Ed25519', status: 'trusted', publicKeyPem: release.publicKey, notBefore: '2020-01-01T00:00:00Z', notAfter: '2099-01-01T00:00:00Z' }] }));
  const installer = Buffer.from('fixture installer: not an executable');
  const files = {
    'package.json': JSON.stringify({ version: '3.7.1' }),
    'package-lock.json': JSON.stringify({ packages: { '': { version: '3.7.1' }, 'node_modules/example': { version: '1.0.0', license: 'MIT' } } }),
    'LICENSE.txt': 'fixture license', 'THIRD-PARTY-NOTICES.txt': 'fixture notices',
    'release.private.pem': release.privateKey, 'root.private.pem': root.privateKey, 'wrong.private.pem': wrong.privateKey,
    'resources/release/root-public-key.pem': root.publicKey,
    'resources/release/release-key-registry.json': registry,
    'resources/release/release-key-registry.json.sig': sign(null, registry, root.privateKey).toString('base64') + '\n',
    'runtime/manifest.json': JSON.stringify({ components: [{ name: 'runtime-fixture', version: '1.2.3' }] }),
    'dist/Egoist-Lagom-Setup.exe': installer,
    'dist/package-integrity.json': JSON.stringify({ version: '3.7.1', publicInstaller: { path: 'dist/Egoist-Lagom-Setup.exe', bytes: installer.length, sha256: createHash('sha256').update(installer).digest('hex') } })
  };
  const integrity = JSON.parse(files['dist/package-integrity.json']);
  integrity.payload = Object.entries(files).filter(([name]) => name.startsWith('resources/release/')).map(([name, content]) => ({ path: name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }));
  files['dist/package-integrity.json'] = JSON.stringify(integrity);
  await Promise.all(Object.entries(files).map(([name, content]) => fs.writeFile(path.join(base, name), content)));
  return { base, dist, trust, root, options: { 'project-root': base, 'runtime-dir': runtime, 'private-key': path.join(base, 'release.private.pem'), 'key-id': 'fixture-release' } };
}

test('prepares and verifies the v3.7.1 public alias without recovery or docs inputs', async t => {
  const f = await fixture(t);
  const integrityPath = path.join(f.dist, 'package-integrity.json');
  const integrity = JSON.parse(await fs.readFile(integrityPath));
  integrity.publicInstaller.sha256 = integrity.publicInstaller.sha256.toUpperCase();
  await fs.writeFile(integrityPath, JSON.stringify(integrity));
  const manifest = await prepareReleaseAssets(f.options);
  assert.equal(manifest.tag, 'v3.7.1');
  assert.equal(manifest.installerName, 'Egoist-Lagom-Setup.exe');
  assert.deepEqual(await prepareReleaseAssets({ ...f.options, 'verify-only': 'true' }), manifest);
  const bom = JSON.parse(await fs.readFile(path.join(f.dist, 'Egoist-Lagom-3.7.1.cdx.json')));
  assert.equal(bom.components.length, 2);
});
test('wrong signing key fails before any metadata is changed', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dist, 'release-manifest.json'), 'previous metadata');
  await assert.rejects(prepareReleaseAssets({ ...f.options, 'private-key': path.join(f.base, 'wrong.private.pem') }), /does not match/);
  assert.equal(await fs.readFile(path.join(f.dist, 'release-manifest.json'), 'utf8'), 'previous metadata');
  assert.deepEqual((await fs.readdir(f.dist)).sort(), ['Egoist-Lagom-Setup.exe', 'package-integrity.json', 'release-manifest.json']);
});

test('release preparation rejects source trust that differs from the packaged trust receipt', async t => {
  const f = await fixture(t);
  const file = path.join(f.dist, 'package-integrity.json');
  const integrity = JSON.parse(await fs.readFile(file));
  integrity.payload[0].sha256 = '0'.repeat(64);
  await fs.writeFile(file, JSON.stringify(integrity));
  await assert.rejects(prepareReleaseAssets(f.options), /packaged trust/);
  assert.equal((await fs.readdir(f.dist)).includes('release-manifest.json'), false);
});

test('missing late input leaves no partial signed manifest', async t => {
  const f = await fixture(t);
  await assert.rejects(prepareReleaseAssets({ ...f.options, notices: path.join(f.base, 'missing.txt') }), /ENOENT/);
  assert.deepEqual((await fs.readdir(f.dist)).sort(), ['Egoist-Lagom-Setup.exe', 'package-integrity.json']);
});

test('tampered registry, installer and signed channel fail validation', async t => {
  const f = await fixture(t);
  await prepareReleaseAssets(f.options);
  await fs.appendFile(path.join(f.dist, 'stable-channel.json'), ' ');
  await assert.rejects(prepareReleaseAssets({ ...f.options, 'verify-only': 'true' }), /Stable channel differs/);
  await fs.appendFile(path.join(f.dist, 'Egoist-Lagom-Setup.exe'), 'changed');
  await assert.rejects(prepareReleaseAssets(f.options), /package-integrity/);
  await fs.writeFile(path.join(f.dist, 'Egoist-Lagom-Setup.exe'), 'fixture installer: not an executable');
  await fs.appendFile(path.join(f.trust, 'release-key-registry.json'), ' ');
  await assert.rejects(prepareReleaseAssets(f.options), /registry signature is invalid/);
});

test('bootstrap preserves pinned trust and refuses a replacement root', async t => {
  const f = await fixture(t);
  const output = path.join(f.base, 'exported-trust');
  const options = { 'trust-dir': f.trust, 'root-private-key': path.join(f.base, 'wrong.private.pem'), 'output-dir': output };
  await assert.rejects(bootstrapReleaseTrust(options), /does not match the pinned root/);
  await assert.rejects(fs.access(output), /ENOENT/);
  assert.deepEqual(await bootstrapReleaseTrust({ ...options, 'root-private-key': path.join(f.base, 'root.private.pem') }), { preservedRoot: true, generatedKeys: false });
  for (const name of await fs.readdir(f.trust)) assert.deepEqual(await fs.readFile(path.join(output, name)), await fs.readFile(path.join(f.trust, name)));
});

test('GitHub preflight verifies offline and rejects changed inputs before any API request', { skip: !process.env.EGOIST_RELEASE_PYTHON }, async t => {
  const f = await fixture(t);
  await prepareReleaseAssets(f.options);
  await fs.writeFile(path.join(f.dist, 'Egoist-Lagom-validation.md'), 'Fixture validation evidence');
  const scripts = path.join(f.base, 'scripts');
  await fs.mkdir(scripts);
  for (const name of ['prepare-release-assets.mjs', 'release-github.py']) await fs.copyFile(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), path.join(scripts, name));
  await fs.writeFile(path.join(scripts, 'github-api.py'), 'def request(*args, **kwargs):\n    raise RuntimeError("UNEXPECTED_API_REQUEST")\n');
  const run = mode => spawnSync(process.env.EGOIST_RELEASE_PYTHON, [path.join(scripts, 'release-github.py'), mode], { encoding: 'utf8', env: { ...process.env, EGOIST_NODE: process.execPath, EGOIST_RELEASE_DIST: f.dist, PYTHONDONTWRITEBYTECODE: '1' } });
  const verified = run('verify');
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /"tag": "v3.7.1"/);
  assert.match(verified.stdout, /Egoist-Lagom-3.7.1.cdx.json/);
  await fs.appendFile(path.join(f.dist, 'Egoist-Lagom-Setup.exe'), 'changed');
  const rejected = run('stage');
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /package-integrity/);
  assert.doesNotMatch(rejected.stderr, /UNEXPECTED_API_REQUEST/);
});
