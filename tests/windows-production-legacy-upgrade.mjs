import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRawHeader } from '@electron/asar';
import { readElectronFuses, productionGuiFuses, productionWorkerFuses } from '../scripts/electron-fuses.mjs';
import { acceptanceEnvironmentErrors, relativePayloadPath } from './windows-production-acceptance.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const official379InstallerSha256 = 'eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6';
export const official379HelperSha256 = 'f6c232fa15e4e8f1d78c149f973df8b807d58cabd8ef5898b8b5ce0d2279da8e';
const officialLegacyReleases = Object.freeze({
  '3.7.8': Object.freeze({ version: '3.7.8',
    installerSha256: '34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927',
    helperSha256: 'e33bca4550b6e130287c8bb2d5c0dccf30b76e033bf99520e81d6c2acda609f5' }),
  '3.7.9': Object.freeze({ version: '3.7.9', installerSha256: official379InstallerSha256,
    helperSha256: official379HelperSha256 }),
});
const pinnedRootSha256 = '30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function officialLegacyRelease(version) {
  assert.ok(typeof version === 'string' && Object.hasOwn(officialLegacyReleases, version),
    'Explicit oldVersion must be exactly 3.7.8 or 3.7.9.');
  return officialLegacyReleases[version];
}

export function decodeLegacySignature(bytes) {
  assert.ok(bytes.length <= 1024, 'Detached signature exceeds its limit.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  const signature = Buffer.from(text, 'base64');
  assert.ok(/^[A-Za-z0-9+/]{86}==$/.test(text) && signature.length === 64 && signature.toString('base64') === text,
    'Invalid canonical Ed25519 detached signature.');
  return signature;
}

export function authenticateLegacyRegistry(bytes, signature, rootBytes, now = Date.now()) {
  return authenticateRegistryAtPinnedRoot(bytes, signature, rootBytes, pinnedRootSha256, now);
}

function authenticateRegistryAtPinnedRoot(bytes, signature, rootBytes, expectedRootSha256, now) {
  assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024, 'Registry exceeds its limit.');
  assert.match(expectedRootSha256, /^[a-f0-9]{64}$/);
  assert.equal(digest(rootBytes), expectedRootSha256, 'Root is not the pinned root.');
  const root = createPublicKey(rootBytes);
  assert.equal(root.asymmetricKeyType, 'ed25519');
  assert.equal(verify(null, bytes, root, decodeLegacySignature(signature)), true, 'Invalid pinned-root registry signature.');
  const registry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.equal(registry.schemaVersion, 1);
  assert.ok(Number.isFinite(Date.parse(registry.generatedAt)) && Date.parse(registry.generatedAt) <= now + 900000);
  assert.ok(Array.isArray(registry.keys) && registry.keys.length > 0 && registry.keys.length <= 128);
  const ids = new Set();
  for (const key of registry.keys) {
    assert.ok(typeof key.id === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(key.id) && !ids.has(key.id));
    ids.add(key.id);
    assert.equal(key.algorithm, 'Ed25519');
    assert.ok(['trusted', 'revoked'].includes(key.status));
    assert.ok(Number.isFinite(Date.parse(key.notBefore)) && Number.isFinite(Date.parse(key.notAfter)) &&
      Date.parse(key.notBefore) < Date.parse(key.notAfter));
    assert.equal(createPublicKey(key.publicKeyPem).asymmetricKeyType, 'ed25519');
  }
  return { registry, digest: digest(bytes) };
}

export function assertLegacyRegistrySuccessor(previous, next) {
  const generation = Date.parse(next.registry.generatedAt) - Date.parse(previous.registry.generatedAt);
  assert.ok(generation >= 0, 'Registry rollback refused.');
  if (generation === 0) assert.equal(next.digest, previous.digest, 'Registry changed without a newer generation.');
  for (const old of previous.registry.keys) {
    const current = next.registry.keys.find(key => key.id === old.id);
    assert.ok(current, 'Registry removed an existing key.');
    assert.deepEqual(createPublicKey(current.publicKeyPem).export({ type: 'spki', format: 'der' }),
      createPublicKey(old.publicKeyPem).export({ type: 'spki', format: 'der' }), 'Existing key material changed.');
    if (old.status === 'revoked') assert.equal(current.status, 'revoked', 'Revoked key reactivated.');
  }
}

export function authenticateLegacyManifest(bytes, signature, trust, expectedVersion, now = Date.now()) {
  assert.ok(bytes.length > 0 && bytes.length <= 128 * 1024, 'Release manifest exceeds its limit.');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.channel, 'stable');
  assert.equal(manifest.version, expectedVersion);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.tag, `v${expectedVersion}`);
  assert.equal(manifest.installerName, `EgoistShield-Setup-${expectedVersion}.exe`);
  assert.equal(manifest.canonicalDownloadUrl,
    `https://github.com/egoist-ai1/egoist-lagom/releases/download/v${expectedVersion}/${manifest.installerName}`);
  assert.ok(Number.isSafeInteger(manifest.size) && manifest.size > 1024 && manifest.size <= 1024 ** 3);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.sha512, /^[a-f0-9]{128}$/);
  assert.equal(manifest.githubDigest, `sha256:${manifest.sha256}`);
  assert.match(manifest.minimumAppVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(['valid', 'not-signed'].includes(manifest.authenticodeStatus));
  assert.ok(typeof manifest.licenseVersion === 'string' && manifest.licenseVersion.trim());
  const key = trust.registry.keys.find(value => value.id === manifest.keyId);
  assert.ok(key && key.status === 'trusted', 'Release key is unknown or revoked.');
  const publishedAt = Date.parse(manifest.publishedAt);
  assert.ok(Number.isFinite(publishedAt) && publishedAt <= now + 900000 &&
    publishedAt >= Date.parse(key.notBefore) && publishedAt <= Date.parse(key.notAfter), 'Release key validity interval failed.');
  assert.equal(verify(null, bytes, createPublicKey(key.publicKeyPem), decodeLegacySignature(signature)), true,
    'Release manifest signature failed.');
  return manifest;
}

export function authenticateOfficialLegacyManifest(bytes, signature, trust, oldVersion, now = Date.now()) {
  const release = officialLegacyRelease(oldVersion);
  const manifest = authenticateLegacyManifest(bytes, signature, trust, release.version, now);
  assert.equal(manifest.sha256, release.installerSha256,
    `Installer is not the audited official ${release.version} release.`);
  return manifest;
}

export function assertCandidateSupportsLegacyVersion(manifest, oldVersion) {
  const release = officialLegacyRelease(oldVersion);
  assert.ok(typeof manifest.minimumAppVersion === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.minimumAppVersion),
    'Invalid candidate minimum version.');
  const minimum = manifest.minimumAppVersion.split('.').map(Number);
  assert.ok(minimum.every(Number.isSafeInteger), 'Invalid candidate minimum version.');
  const installed = release.version.split('.').map(Number);
  const different = minimum.findIndex((number, index) => number !== installed[index]);
  assert.ok(different === -1 || minimum[different] < installed[different],
    `Candidate minimum version excludes ${release.version}.`);
}

export function assertSignedCandidateSource(manifest, integrityBytes, expectedSourceCommit) {
  assert.match(expectedSourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.sourceCommit, expectedSourceCommit, 'Signed candidate source commit differs.');
  assert.match(manifest.integrityManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(digest(integrityBytes), manifest.integrityManifestSha256, 'Signed integrity-file digest differs.');
  const integrity = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(integrityBytes));
  assert.equal(integrity.product, 'Egoist Lagom');
  assert.equal(integrity.version, manifest.version);
  assert.equal(integrity.source.commit, expectedSourceCommit);
  assert.equal(integrity.installer.sha256.toLowerCase(), manifest.sha256);
  assert.equal(integrity.installer.bytes, manifest.size);
  assert.equal(path.posix.basename(integrity.installer.path), manifest.installerName);
  return integrity;
}

async function ordinary(file, directory = false) {
  let current = path.resolve(file), first = true;
  while (true) {
    const info = await fs.lstat(current);
    assert.ok(!info.isSymbolicLink() && (!first || (directory ? info.isDirectory() : info.isFile() && info.nlink === 1)),
      'Ordinary unlinked filesystem path required: ' + current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent; first = false;
  }
}
async function boundedRead(file, maximum) {
  await ordinary(file);
  assert.ok((await fs.stat(file)).size <= maximum, 'File exceeds read limit: ' + file);
  return fs.readFile(file);
}
async function hashes(file) {
  await ordinary(file);
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  for await (const chunk of createReadStream(file)) { sha256.update(chunk); sha512.update(chunk); }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('hex'), bytes: (await fs.stat(file)).size };
}
function within(file, root) {
  assert.ok(path.isAbsolute(file) && path.resolve(file).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep),
    'Path escaped the disposable runner scope.');
}

export function authenticateCurrentCandidateBytes(inputs, { now = Date.now(), expectedRootSha256 = pinnedRootSha256 } = {}) {
  const bundledTrust = authenticateRegistryAtPinnedRoot(inputs.bundledRegistryBytes, inputs.bundledRegistrySignature,
    inputs.rootBytes, expectedRootSha256, now);
  const candidateTrust = authenticateRegistryAtPinnedRoot(inputs.candidateRegistryBytes, inputs.candidateRegistrySignature,
    inputs.rootBytes, expectedRootSha256, now);
  assertLegacyRegistrySuccessor(bundledTrust, candidateTrust);
  const candidate = authenticateLegacyManifest(inputs.manifestBytes, inputs.manifestSignature, candidateTrust, '3.8.0', now);
  assertSignedCandidateSource(candidate, inputs.integrityBytes, inputs.sourceCommit);
  return { kind: 'current-candidate-authentication', candidate, sourceCommit: inputs.sourceCommit,
    rootSha256: digest(inputs.rootBytes), bundledRegistrySha256: bundledTrust.digest,
    candidateRegistrySha256: candidateTrust.digest, candidateManifestSha256: digest(inputs.manifestBytes),
    integrityManifestSha256: digest(inputs.integrityBytes) };
}

export async function verifyCurrentCandidateInstaller(file, candidate) {
  const actual = await hashes(file);
  assert.deepEqual(actual, { sha256: candidate.sha256, sha512: candidate.sha512, bytes: candidate.size },
    'Actual current installer differs from authenticated manifest.');
  return actual;
}

export function assertCurrentCandidateOptions(options, { runnerTemp, work, sourceCommit }) {
  assert.deepEqual(Object.keys(options).sort(), ['candidateAssets', 'integrityPath', 'output', 'sourceCommit'],
    'Current authentication accepts only current candidate options.');
  assert.match(options.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(options.sourceCommit, sourceCommit, 'Current candidate source differs from GITHUB_SHA.');
  within(options.candidateAssets, runnerTemp);
  within(options.integrityPath, runnerTemp);
  within(options.output, work);
}

async function verifyCurrentAssets(options) {
  const result = authenticateCurrentCandidateBytes({
    rootBytes: await boundedRead(path.join(projectRoot, 'resources/release/root-public-key.pem'), 4096),
    bundledRegistryBytes: await boundedRead(path.join(projectRoot, 'resources/release/release-key-registry.json'), 256 * 1024),
    bundledRegistrySignature: await boundedRead(path.join(projectRoot, 'resources/release/release-key-registry.json.sig'), 1024),
    candidateRegistryBytes: await boundedRead(path.join(options.candidateAssets, 'release-key-registry.json'), 256 * 1024),
    candidateRegistrySignature: await boundedRead(path.join(options.candidateAssets, 'release-key-registry.json.sig'), 1024),
    manifestBytes: await boundedRead(path.join(options.candidateAssets, 'release-manifest.json'), 128 * 1024),
    manifestSignature: await boundedRead(path.join(options.candidateAssets, 'release-manifest.json.sig'), 1024),
    integrityBytes: await boundedRead(options.integrityPath, 16 * 1024 * 1024),
    sourceCommit: options.sourceCommit,
  });
  const installer = await verifyCurrentCandidateInstaller(path.join(options.candidateAssets, result.candidate.installerName), result.candidate);
  return { ...result, installer, crypto: 'real Ed25519 over original bytes; project pinned root; no supplied CLI keys' };
}

async function verifyAssets(options) {
  const oldReleaseProfile = officialLegacyRelease(options.oldVersion);
  const rootBytes = await boundedRead(path.join(projectRoot, 'resources/release/root-public-key.pem'), 4096);
  const oldBytes = await boundedRead(path.join(options.oldAssets, 'release-key-registry.json'), 256 * 1024);
  const oldSig = await boundedRead(path.join(options.oldAssets, 'release-key-registry.json.sig'), 1024);
  const oldTrust = authenticateLegacyRegistry(oldBytes, oldSig, rootBytes);
  const candidateTrust = authenticateLegacyRegistry(
    await boundedRead(path.join(options.candidateAssets, 'release-key-registry.json'), 256 * 1024),
    await boundedRead(path.join(options.candidateAssets, 'release-key-registry.json.sig'), 1024), rootBytes);
  assertLegacyRegistrySuccessor(oldTrust, candidateTrust);
  const old = authenticateOfficialLegacyManifest(await boundedRead(path.join(options.oldAssets, 'release-manifest.json'), 128 * 1024),
    await boundedRead(path.join(options.oldAssets, 'release-manifest.json.sig'), 1024), oldTrust, oldReleaseProfile.version);
  const candidateBytes = await boundedRead(path.join(options.candidateAssets, 'release-manifest.json'), 128 * 1024);
  const candidateSig = await boundedRead(path.join(options.candidateAssets, 'release-manifest.json.sig'), 1024);
  const candidate = authenticateLegacyManifest(candidateBytes, candidateSig, candidateTrust, '3.8.0');
  // The old bundled registry must already accept this exact real signing key.
  // Remote registry migration and latest-feed discovery are separate gates.
  authenticateLegacyManifest(candidateBytes, candidateSig, oldTrust, '3.8.0');
  assertCandidateSupportsLegacyVersion(candidate, oldReleaseProfile.version);
  const integrityBytes = await boundedRead(options.integrityPath, 16 * 1024 * 1024);
  assertSignedCandidateSource(candidate, integrityBytes, options.sourceCommit);
  for (const [manifest, directory] of [[old, options.oldAssets], [candidate, options.candidateAssets]]) {
    const actual = await hashes(path.join(directory, manifest.installerName));
    assert.deepEqual(actual, { sha256: manifest.sha256, sha512: manifest.sha512, bytes: manifest.size },
      'Actual installer differs from authenticated manifest.');
  }
  let installed = null;
  if (options.installedRoot) {
    assert.equal(path.resolve(options.installedRoot).toLowerCase(), path.join(process.env.ProgramFiles, 'EgoistShield').toLowerCase());
    assert.deepEqual(await boundedRead(path.join(options.installedRoot, 'resources/release/root-public-key.pem'), 4096), rootBytes);
    const installedRegistry = await boundedRead(path.join(options.installedRoot, 'resources/release/release-key-registry.json'), 256 * 1024);
    const installedSig = await boundedRead(path.join(options.installedRoot, 'resources/release/release-key-registry.json.sig'), 1024);
    assert.deepEqual(installedRegistry, oldBytes, 'Installed old registry differs from authenticated official assets.');
    assert.deepEqual(installedSig, oldSig);
    const installedTrust = authenticateLegacyRegistry(installedRegistry, installedSig, rootBytes);
    authenticateLegacyManifest(candidateBytes, candidateSig, installedTrust, '3.8.0');
    const helper = path.join(options.installedRoot, 'resources/installer/invoke-final-silent-reinstall.ps1');
    assert.equal((await hashes(helper)).sha256, oldReleaseProfile.helperSha256,
      `Actual installed legacy helper differs from audited ${oldReleaseProfile.version}.`);
    installed = { version: oldReleaseProfile.version, rootSha256: digest(rootBytes), registrySha256: installedTrust.digest,
      helperSha256: oldReleaseProfile.helperSha256,
      candidateAcceptedByInstalledBundledKey: true };
  }
  return { oldVersion: oldReleaseProfile.version, oldReleaseProfile, old, candidate, installed,
    rootSha256: digest(rootBytes), oldRegistrySha256: oldTrust.digest,
    candidateRegistrySha256: candidateTrust.digest, candidateManifestSha256: digest(candidateBytes),
    integrityManifestSha256: digest(integrityBytes), crypto: 'real Ed25519 verification over original bytes; no supplied keys',
    publicLatestFeedDiscoveryTested: false };
}

async function verifyPayload(options) {
  const integrityBytes = await boundedRead(options.integrityPath, 16 * 1024 * 1024);
  assert.equal(digest(integrityBytes), options.integritySha256);
  const integrity = JSON.parse(integrityBytes);
  assert.equal(integrity.source.commit, options.sourceCommit);
  assert.equal(integrity.version, '3.8.0');
  assert.equal(integrity.installer.sha256.toLowerCase(), options.installerSha256);
  assert.ok(Array.isArray(integrity.payload) && integrity.payload.length > 20);
  const payload = [], unique = new Set();
  for (const entry of integrity.payload) {
    assert.ok(!unique.has(entry.path)); unique.add(entry.path);
    const file = relativePayloadPath(options.installedRoot, entry.path);
    const actual = await hashes(file);
    assert.equal(actual.bytes, entry.bytes, entry.path + ' bytes');
    assert.equal(actual.sha256, entry.sha256.toLowerCase(), entry.path + ' hash');
    payload.push({ path: entry.path, bytes: actual.bytes, sha256: actual.sha256 });
  }
  const inventory = JSON.parse(await boundedRead(path.join(options.installedRoot, 'resources/worker-host-integrity.json'), 128 * 1024));
  assert.equal(inventory.owner, 'EgoistShield'); assert.equal(inventory.packageVersion, '3.8.0');
  assert.equal(inventory.guiFuseWire, productionGuiFuses); assert.equal(inventory.workerFuseWire, productionWorkerFuses);
  const inventoryPaths = [];
  for (const entry of inventory.files) {
    const actual = await hashes(relativePayloadPath(options.installedRoot, entry.path));
    assert.equal(actual.bytes, entry.bytes); assert.equal(actual.sha256, entry.sha256.toLowerCase()); inventoryPaths.push(entry.path);
  }
  assert.ok(inventoryPaths.includes('EgoistShield.Worker.exe'));
  const fuses = {};
  for (const [role, file, expected] of [['gui', 'EgoistShield.exe', productionGuiFuses], ['worker', 'EgoistShield.Worker.exe', productionWorkerFuses]]) {
    const fuse = readElectronFuses(await boundedRead(path.join(options.installedRoot, file), 256 * 1024 * 1024));
    assert.equal(fuse.wire, expected); fuses[role] = { version: fuse.version, count: fuse.count, wire: fuse.wire };
  }
  const header = getRawHeader(path.join(options.installedRoot, 'resources/app.asar')).headerString;
  const asarHeaderSha256 = digest(header);
  assert.equal(asarHeaderSha256, integrity.electronFuses.asarHeaderSha256);
  return { verified: payload, inventoryVerified: inventoryPaths, fuses, asarHeaderSha256 };
}

async function main() {
  assert.equal(process.platform, 'win32');
  const errors = acceptanceEnvironmentErrors(process.env);
  assert.equal(errors.length, 0, 'Disposable hosted runner guard refused: ' + errors.join(', '));
  const [command, optionsPath] = process.argv.slice(2);
  assert.ok(['verify-assets', 'verify-current-assets', 'verify-payload'].includes(command));
  assert.ok(typeof process.env.RUNNER_TEMP === 'string' && path.isAbsolute(process.env.RUNNER_TEMP), 'Absolute own RUNNER_TEMP required.');
  const work = path.join(path.resolve(process.env.RUNNER_TEMP), `lagom-legacy-native-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
  within(optionsPath, work);
  const options = JSON.parse(await boundedRead(optionsPath, 16384));
  within(options.output, work); within(options.integrityPath, process.env.RUNNER_TEMP);
  assert.match(options.sourceCommit, /^[a-f0-9]{40}$/);
  if (command === 'verify-current-assets') {
    assert.equal(process.argv.slice(2).length, 2, 'Current authentication requires command and options.json only.');
    assertCurrentCandidateOptions(options, { runnerTemp: process.env.RUNNER_TEMP, work, sourceCommit: process.env.GITHUB_SHA });
    await ordinary(options.candidateAssets, true);
  }
  if (command === 'verify-assets') {
    officialLegacyRelease(options.oldVersion);
    within(options.oldAssets, process.env.RUNNER_TEMP); within(options.candidateAssets, process.env.RUNNER_TEMP);
    await ordinary(options.oldAssets, true); await ordinary(options.candidateAssets, true);
  }
  if (options.installedRoot) {
    assert.equal(path.resolve(options.installedRoot).toLowerCase(), path.join(process.env.ProgramFiles, 'EgoistShield').toLowerCase());
    await ordinary(options.installedRoot, true);
  }
  const result = await (command === 'verify-assets' ? verifyAssets(options)
    : command === 'verify-current-assets' ? verifyCurrentAssets(options) : verifyPayload(options));
  await fs.writeFile(options.output, JSON.stringify({ ok: true, ...result }, null, 2) + '\n', { flag: 'wx' });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
