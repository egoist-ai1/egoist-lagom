import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { legacyLocalSidecarNames, verifyLegacyLocalMetadata, verifyLegacyLocalTransport,
  stageLegacyLocalTransport } from './windows-legacy-local-transport.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referenceRoot = path.join(projectRoot, 'docs/reliability-3.7.9/network/public-artifacts/candidate');
const metadata = Object.fromEntries(await Promise.all([
  ['manifestBytes', 'release-manifest.json'], ['manifestSignatureBytes', 'release-manifest.json.sig'],
  ['registryBytes', 'release-key-registry.json'], ['registrySignatureBytes', 'release-key-registry.json.sig'],
].map(async ([key, name]) => [key, await fs.readFile(path.join(referenceRoot, name))])));
const work = process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
const filesystemSkip = !work && 'An explicit own test work directory is required.';
const installerSha256 = '34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  assert.ok(path.isAbsolute(work), 'Test work must be absolute.');
  const ownedRoot = await fs.mkdtemp(path.join(work, 'legacy-local-transport-'));
  const candidate = path.join(ownedRoot, 'candidate'); await fs.mkdir(candidate);
  await fs.writeFile(path.join(candidate, legacyLocalSidecarNames[0]), 'Inert installer bytes: never executed.');
  await fs.writeFile(path.join(candidate, legacyLocalSidecarNames[1]), metadata.manifestBytes);
  await fs.writeFile(path.join(candidate, legacyLocalSidecarNames[2]), metadata.manifestSignatureBytes);
  await fs.writeFile(path.join(candidate, 'release-key-registry.json'), metadata.registryBytes);
  await fs.writeFile(path.join(candidate, 'release-key-registry.json.sig'), metadata.registrySignatureBytes);
  return { ownedRoot, sidecarDirectory: candidate, candidateRegistryDirectory: candidate,
    oldAssetsDirectory: path.join(ownedRoot, 'oldAssets'), sourceReleaseId: 123 };
}
async function absent(destination) {
  await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
}
async function refusesBeforeDestination(options, pattern) {
  await assert.rejects(stageLegacyLocalTransport(options), pattern);
  await absent(options.oldAssetsDirectory);
}

test('preserved original 3.7.8 metadata authenticates against the real project pinned root', async () => {
  const proof = await verifyLegacyLocalMetadata(metadata);
  assert.equal(proof.manifest.version, '3.7.8'); assert.equal(proof.manifest.size, 194405835);
  assert.equal(proof.manifest.sha256, installerSha256);
  assert.equal(proof.rootSha256, '30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7');
  assert.equal(proof.registrySha256, 'd3cbbd5b636adbb5f47733be32197f0d7dd7ed3294d8785b1aa4b9bb51197dbc');
  assert.deepEqual(legacyLocalSidecarNames, ['legacy-local-EgoistShield-Setup-3.7.8.exe',
    'legacy-local-3.7.8-release-manifest.json', 'legacy-local-3.7.8-release-manifest.json.sig']);
});

test('tampered original manifest, signatures or candidate registry bytes are rejected', async () => {
  for (const key of Object.keys(metadata)) {
    const changed = Buffer.from(metadata[key]); changed[changed.length - 2] ^= 1;
    await assert.rejects(verifyLegacyLocalMetadata({ ...metadata, [key]: changed }), /original/);
  }
});

test('same-value reserialization and a substituted version cannot replace original signed bytes', async () => {
  const parsed = JSON.parse(metadata.manifestBytes);
  for (const changed of [Buffer.from(JSON.stringify(parsed)), Buffer.from(JSON.stringify({ ...parsed, version: '3.7.9' }))])
    await assert.rejects(verifyLegacyLocalMetadata({ ...metadata, manifestBytes: changed }), /original 3\.7\.8 bytes/);
});

test('metadata is strictly bounded binary input, with no supplied trust override', async () => {
  for (const manifestBytes of ['', metadata.manifestBytes.toString('utf8'), Buffer.alloc(0), Buffer.alloc(128 * 1024 + 1)])
    await assert.rejects(verifyLegacyLocalMetadata({ ...metadata, manifestBytes }), /bounded bytes/);
  await assert.rejects(verifyLegacyLocalMetadata({ ...metadata, manifestSignatureBytes: Buffer.alloc(1025) }), /bounded bytes/);
});

test('inert installer fixture cannot be staged as authentic Setup and creates no destination', { skip: filesystemSkip }, async () => {
  const options = await fixture();
  await refusesBeforeDestination(options, /Setup differs from the original signed 3\.7\.8 manifest/);
  await assert.rejects(verifyLegacyLocalTransport(options), /Setup differs/);
});

test('unknown options, noncanonical draft IDs and escaped paths fail before staging', { skip: filesystemSkip }, async () => {
  const options = await fixture();
  await refusesBeforeDestination({ ...options, rootPublicKey: 'supplied-key.pem' }, /Unknown transport option/);
  for (const sourceReleaseId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123', null])
    await refusesBeforeDestination({ ...options, sourceReleaseId }, /positive safe integer/);
  for (const sidecarDirectory of [options.ownedRoot, options.ownedRoot + '-foreign', 'relative-candidate'])
    await refusesBeforeDestination({ ...options, sidecarDirectory }, /inside the explicit owned root|Absolute transport paths/);
  await refusesBeforeDestination({ ...options, candidateRegistryDirectory: path.dirname(options.ownedRoot) }, /inside the explicit owned root/);
  const escaped = path.join(path.dirname(options.ownedRoot), 'outside-never-created');
  await refusesBeforeDestination({ ...options, oldAssetsDirectory: escaped }, /inside the explicit owned root/);
});

test('staging rejects existing destinations, source overlap, and Windows path aliases', { skip: filesystemSkip }, async () => {
  const options = await fixture();
  await fs.mkdir(options.oldAssetsDirectory);
  await assert.rejects(stageLegacyLocalTransport(options), /fresh and absent/);
  assert.deepEqual(await fs.readdir(options.oldAssetsDirectory), []);
  for (const oldAssetsDirectory of [options.sidecarDirectory, path.join(options.sidecarDirectory, 'nested'),
    path.join(options.ownedRoot, 'oldAssets.'), path.join(options.ownedRoot, 'oldAssets '),
    path.join(options.ownedRoot, 'NUL'), path.join(options.ownedRoot, 'COM1.txt'), path.join(options.ownedRoot, 'old:stream')])
    await assert.rejects(stageLegacyLocalTransport({ ...options, oldAssetsDirectory }), /must not overlap|Windows filesystem alias/);
});

test('exact sidecar set rejects missing, extra and case-substituted names', { skip: filesystemSkip }, async () => {
  for (const mode of ['missing', 'extra', 'case']) {
    const options = await fixture(), original = path.join(options.sidecarDirectory, legacyLocalSidecarNames[1]);
    if (mode === 'missing') await fs.unlink(original);
    if (mode === 'extra') await fs.writeFile(path.join(options.sidecarDirectory, 'legacy-local-unexpected.json'), '{}');
    if (mode === 'case') await fs.rename(original, path.join(options.sidecarDirectory, 'Legacy-Local-3.7.8-release-manifest.json'));
    await refusesBeforeDestination(options, /Exactly the three original/);
  }
});

test('candidate registry or old manifest corruption fails before copying any files', { skip: filesystemSkip }, async () => {
  for (const name of ['release-key-registry.json', 'release-key-registry.json.sig', legacyLocalSidecarNames[1], legacyLocalSidecarNames[2]]) {
    const options = await fixture(); await fs.appendFile(path.join(options.sidecarDirectory, name), '\n');
    await refusesBeforeDestination(options, /original/);
  }
});

test('hardlinked files, leaf directories and junction ancestors are rejected in own fixtures', { skip: filesystemSkip }, async () => {
  const hard = await fixture();
  await fs.link(path.join(hard.sidecarDirectory, legacyLocalSidecarNames[0]), path.join(hard.ownedRoot, 'own-hardlink.exe'));
  await refusesBeforeDestination(hard, /Ordinary unlinked/);
  const directory = await fixture(), file = path.join(directory.sidecarDirectory, legacyLocalSidecarNames[0]);
  await fs.unlink(file); await fs.mkdir(file); await refusesBeforeDestination(directory, /Ordinary unlinked/);
  const junction = await fixture(), alias = path.join(junction.ownedRoot, 'own-alias');
  await fs.symlink(junction.sidecarDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await refusesBeforeDestination({ ...junction, sidecarDirectory: alias }, /Ordinary unlinked|filesystem alias/);
  await assert.rejects(stageLegacyLocalTransport({ ...junction, oldAssetsDirectory: path.join(alias, 'out') }), /Ordinary unlinked|must not overlap/);
});

test('missing or oversized metadata is terminal and never produces a readiness receipt', { skip: filesystemSkip }, async () => {
  const missing = await fixture(); await fs.unlink(path.join(missing.sidecarDirectory, 'release-key-registry.json.sig'));
  await refusesBeforeDestination(missing, /ENOENT/);
  const large = await fixture(); await fs.writeFile(path.join(large.sidecarDirectory, legacyLocalSidecarNames[1]), Buffer.alloc(128 * 1024 + 1));
  await refusesBeforeDestination(large, /metadata exceeds its limit/);
});

test('physical CLI guard refuses verify and stage before reading nonexistent inputs or writing paths', () => {
  for (const command of ['verify', 'stage']) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'tests/windows-legacy-local-transport.mjs'), command], {
      env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' },
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.match(result.stderr, process.platform === 'win32' ? /hosted runner transport guard refused before inputs.*GITHUB_ACTIONS/ : /requires Windows/);
    assert.equal(result.stdout, '');
  }
});

async function installerDigest(file) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const part of createReadStream(file)) { hash.update(part); bytes += part.length; }
  return { bytes, sha256: hash.digest('hex') };
}
const originalInstaller = path.join(projectRoot, 'dist/EgoistShield-Setup-3.7.8.exe');
const installerPresent = await fs.stat(originalInstaller).then(value => value.isFile()).catch(error => {
  if (error.code === 'ENOENT') return false; throw error;
});

test('actual original Setup is authenticated and exclusively copied unchanged, without execution',
  { skip: filesystemSkip || (!installerPresent && 'Original local Setup not present in this checkout.'), timeout: 120000 }, async () => {
    assert.deepEqual(await installerDigest(originalInstaller), { bytes: 194405835, sha256: installerSha256 });
    const options = await fixture(), prefix = path.join(options.sidecarDirectory, legacyLocalSidecarNames[0]);
    await fs.copyFile(originalInstaller, prefix);
    const verified = await verifyLegacyLocalTransport(options);
    assert.equal(verified.manifest.version, '3.7.8'); assert.equal(verified.installer.bytes, 194405835);
    await absent(options.oldAssetsDirectory);
    const receipt = await stageLegacyLocalTransport(options);
    assert.equal(receipt.transport, 'original-signed-local-generation'); assert.equal(receipt.oldVersion, '3.7.8');
    assert.equal(receipt.publishedOriginVerified, false); assert.equal(receipt.sourceReleaseId, 123);
    assert.equal(receipt.sourceReleaseIdRole, 'transport-draft'); assert.equal(receipt.draftApiStatusVerifiedByTransporter, false);
    assert.equal(receipt.harnessSourceCommit, process.env.GITHUB_SHA ?? null);
    assert.match(receipt.harnessSourceCommitOrigin, /not a legacy generation commit/);
    assert.equal(receipt.installerExecuted, false); assert.equal(receipt.publicFeedDiscoveryTested, false);
    assert.deepEqual((await fs.readdir(options.oldAssetsDirectory)).sort(), ['EgoistShield-Setup-3.7.8.exe',
      'release-manifest.json', 'release-manifest.json.sig', 'release-key-registry.json', 'release-key-registry.json.sig', 'provenance.json'].sort());
    for (const item of receipt.files) {
      const file = path.join(options.oldAssetsDirectory, item.name);
      assert.equal((await fs.stat(file)).size, item.bytes); assert.equal((await fs.lstat(file)).nlink, 1);
      if (item.name.endsWith('.exe')) assert.deepEqual(await installerDigest(file), { bytes: 194405835, sha256: installerSha256 });
      else assert.equal(sha256(await fs.readFile(file)), item.sha256);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.oldAssetsDirectory, 'provenance.json'), 'utf8')), receipt);
    await assert.rejects(stageLegacyLocalTransport(options), /fresh and absent/);
    const ownCorruptedCopy = await fs.open(prefix, 'r+');
    try { await ownCorruptedCopy.write(Buffer.from([0]), 0, 1, 0); } finally { await ownCorruptedCopy.close(); }
    await refusesBeforeDestination({ ...options, oldAssetsDirectory: path.join(options.ownedRoot, 'corrupted-never-staged') }, /Setup differs/);
    await fs.access(originalInstaller, constants.R_OK);
  });
