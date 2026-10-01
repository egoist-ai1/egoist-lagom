import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticateLegacyRegistry, authenticateOfficialLegacyManifest } from './windows-production-legacy-upgrade.mjs';
import { acceptanceEnvironmentErrors } from './windows-production-acceptance.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalMetadataRoot = path.join(projectRoot, 'docs/reliability-3.7.9/network/public-artifacts/candidate');
export const legacyLocalSidecarNames = Object.freeze([
  'legacy-local-EgoistShield-Setup-3.7.8.exe',
  'legacy-local-3.7.8-release-manifest.json',
  'legacy-local-3.7.8-release-manifest.json.sig',
]);
const registryNames = ['release-key-registry.json', 'release-key-registry.json.sig'];
const originalManifestNames = ['release-manifest.json', 'release-manifest.json.sig'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function absolute(file) {
  assert.ok(typeof file === 'string' && path.isAbsolute(file), 'Absolute transport paths are required.');
  return path.resolve(file);
}
function within(file, root) {
  const relative = path.relative(canonical(root), canonical(file));
  assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep),
    'Transport path must stay inside the explicit owned root.');
}
function overlaps(first, second) {
  const relative = path.relative(canonical(first), canonical(second));
  return !relative || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
async function ordinary(file, directory = false) {
  let current = absolute(file), first = true;
  while (true) {
    const stat = await fs.lstat(current);
    assert.ok(!stat.isSymbolicLink() && (first ? directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1 : stat.isDirectory()),
      'Ordinary unlinked transport path required: ' + current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent; first = false;
  }
  assert.equal(canonical(await fs.realpath(file)), canonical(file), 'Transport path contains a filesystem alias.');
}
async function boundedRead(file, maximum) {
  await ordinary(file);
  const before = await fs.stat(file);
  assert.ok(before.size > 0 && before.size <= maximum, 'Transport metadata exceeds its limit.');
  const chunks = []; let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    assert.ok(bytes <= maximum, 'Transport metadata grew beyond its limit.');
    chunks.push(chunk);
  }
  await ordinary(file);
  const after = await fs.stat(file);
  assert.ok(bytes === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs &&
    after.ino === before.ino && after.dev === before.dev, 'Transport metadata changed during reading.');
  return Buffer.concat(chunks, bytes);
}
async function fileHashes(file, maximum = 1024 ** 3) {
  await ordinary(file);
  const before = await fs.stat(file);
  assert.ok(before.size > 0 && before.size <= maximum, 'Transport file exceeds its size bound.');
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    assert.ok(bytes <= maximum, 'Transport file grew beyond its bound.');
    sha256.update(chunk); sha512.update(chunk);
  }
  await ordinary(file);
  const after = await fs.stat(file);
  assert.ok(bytes === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs &&
    after.ino === before.ino && after.dev === before.dev, 'Transport source changed during hashing.');
  return { bytes, sha256: sha256.digest('hex'), sha512: sha512.digest('hex') };
}

export async function verifyLegacyLocalMetadata({ manifestBytes, manifestSignatureBytes, registryBytes, registrySignatureBytes }) {
  for (const [bytes, maximum] of [[manifestBytes, 128 * 1024], [manifestSignatureBytes, 1024],
    [registryBytes, 256 * 1024], [registrySignatureBytes, 1024]])
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, 'Original metadata must be bounded bytes.');
  const reference = await Promise.all([
    boundedRead(path.join(originalMetadataRoot, originalManifestNames[0]), 128 * 1024),
    boundedRead(path.join(originalMetadataRoot, originalManifestNames[1]), 1024),
    boundedRead(path.join(originalMetadataRoot, registryNames[0]), 256 * 1024),
    boundedRead(path.join(originalMetadataRoot, registryNames[1]), 1024),
    boundedRead(path.join(projectRoot, 'resources/release/root-public-key.pem'), 4096),
  ]);
  assert.deepEqual(manifestBytes, reference[0], 'Sidecar manifest is not the preserved original 3.7.8 bytes.');
  assert.deepEqual(manifestSignatureBytes, reference[1], 'Sidecar signature is not the preserved original 3.7.8 bytes.');
  assert.deepEqual(registryBytes, reference[2], 'Candidate registry differs from the original 3.7.8 registry.');
  assert.deepEqual(registrySignatureBytes, reference[3], 'Candidate registry signature differs from original 3.7.8.');
  const trust = authenticateLegacyRegistry(registryBytes, registrySignatureBytes, reference[4]);
  const manifest = authenticateOfficialLegacyManifest(manifestBytes, manifestSignatureBytes, trust, '3.7.8');
  return { manifest, rootSha256: digest(reference[4]), registrySha256: trust.digest,
    manifestSha256: digest(manifestBytes), crypto: 'Original byte equality and existing pinned-root Ed25519 verification' };
}

async function transportPaths(options, includeDestination) {
  const allowed = new Set(['ownedRoot', 'sidecarDirectory', 'candidateRegistryDirectory', 'oldAssetsDirectory', 'sourceReleaseId']);
  assert.ok(options && typeof options === 'object' && !Array.isArray(options), 'Transport options object required.');
  assert.ok(Object.keys(options).every(key => allowed.has(key)), 'Unknown transport option.');
  assert.ok(Number.isSafeInteger(options.sourceReleaseId) && options.sourceReleaseId > 0,
    'sourceReleaseId must identify the transport draft with a positive safe integer.');
  const root = absolute(options.ownedRoot), sidecars = absolute(options.sidecarDirectory), registry = absolute(options.candidateRegistryDirectory);
  within(sidecars, root); within(registry, root);
  await ordinary(root, true); await ordinary(sidecars, true); await ordinary(registry, true);
  const names = (await fs.readdir(sidecars)).filter(name => /^legacy-local-/i.test(name)).sort();
  assert.deepEqual(names, [...legacyLocalSidecarNames].sort(), 'Exactly the three original local-generation sidecar names are required.');
  const files = [
    ...legacyLocalSidecarNames.map(name => path.join(sidecars, name)),
    ...registryNames.map(name => path.join(registry, name)),
  ];
  for (const file of files) await ordinary(file);
  let destination = null;
  if (includeDestination) {
    destination = absolute(options.oldAssetsDirectory); within(destination, root);
    assert.ok(!/[. ]$/.test(path.basename(destination)) && !path.basename(destination).includes(':') &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path.basename(destination)), 'Destination has a Windows filesystem alias.');
    assert.ok(!overlaps(destination, sidecars) && !overlaps(sidecars, destination) &&
      !overlaps(destination, registry) && !overlaps(registry, destination), 'Transport inputs and destination must not overlap.');
    await ordinary(path.dirname(destination), true);
    const existing = await fs.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert.equal(existing, null, 'oldAssets destination must be fresh and absent.');
  }
  return { root, sidecars, registry, files, destination };
}

async function verifiedSources(paths) {
  const [manifestBytes, manifestSignatureBytes, registryBytes, registrySignatureBytes] = await Promise.all([
    boundedRead(paths.files[1], 128 * 1024), boundedRead(paths.files[2], 1024),
    boundedRead(paths.files[3], 256 * 1024), boundedRead(paths.files[4], 1024),
  ]);
  const metadata = await verifyLegacyLocalMetadata({ manifestBytes, manifestSignatureBytes, registryBytes, registrySignatureBytes });
  const installer = await fileHashes(paths.files[0]);
  assert.deepEqual(installer, { bytes: metadata.manifest.size, sha256: metadata.manifest.sha256, sha512: metadata.manifest.sha512 },
    'Actual local-generation Setup differs from the original signed 3.7.8 manifest.');
  const targets = ['EgoistShield-Setup-3.7.8.exe', ...originalManifestNames, ...registryNames];
  const files = [{ source: paths.files[0], targetName: targets[0], ...installer }];
  const originalBytes = [manifestBytes, manifestSignatureBytes, registryBytes, registrySignatureBytes];
  for (let index = 1; index < paths.files.length; index++) {
    const bytes = originalBytes[index - 1];
    const expected = { bytes: bytes.length, sha256: digest(bytes), sha512: createHash('sha512').update(bytes).digest('hex') };
    assert.deepEqual(await fileHashes(paths.files[index], 256 * 1024), expected, 'Metadata source changed after authentication.');
    files.push({ source: paths.files[index], targetName: targets[index], ...expected });
  }
  return { ...metadata, installer, files };
}

export async function verifyLegacyLocalTransport(options) {
  return verifiedSources(await transportPaths(options, false));
}

export async function stageLegacyLocalTransport(options) {
  const paths = await transportPaths(options, true);
  const verified = await verifiedSources(paths);
  const observedSha = process.env.GITHUB_SHA ?? null;
  assert.ok(observedSha === null || /^[a-f0-9]{40}$/.test(observedSha), 'Observed harness GITHUB_SHA is invalid.');
  await ordinary(path.dirname(paths.destination), true);
  await fs.mkdir(paths.destination);
  const readbacks = [];
  for (const entry of verified.files) {
    await ordinary(paths.destination, true);
    const target = path.join(paths.destination, entry.targetName);
    await fs.copyFile(entry.source, target, constants.COPYFILE_EXCL);
    const actual = await fileHashes(target);
    assert.deepEqual(actual, { bytes: entry.bytes, sha256: entry.sha256, sha512: entry.sha512 }, 'Exclusive transport copy changed original bytes.');
    readbacks.push({ name: entry.targetName, ...actual });
  }
  const receipt = { schemaVersion: 1, transport: 'original-signed-local-generation', oldVersion: '3.7.8',
    publishedOriginVerified: false, sourceReleaseId: options.sourceReleaseId, sourceReleaseIdRole: 'transport-draft',
    draftApiStatusVerifiedByTransporter: false, harnessSourceCommit: observedSha,
    harnessSourceCommitOrigin: 'GITHUB_SHA observed at staging; not a legacy generation commit',
    stagedAtUtc: new Date().toISOString(), sourceAssetNames: [...legacyLocalSidecarNames],
    rootSha256: verified.rootSha256, originalRegistrySha256: verified.registrySha256,
    originalManifestSha256: verified.manifestSha256, crypto: verified.crypto, files: readbacks,
    installerExecuted: false, publicFeedDiscoveryTested: false };
  await fs.writeFile(path.join(paths.destination, 'provenance.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

async function main() {
  assert.equal(process.platform, 'win32', 'Local-generation CI transport requires Windows.');
  const errors = acceptanceEnvironmentErrors(process.env);
  assert.equal(errors.length, 0, 'Disposable hosted runner transport guard refused before inputs: ' + errors.join(', '));
  const [command, ...args] = process.argv.slice(2);
  assert.ok(['verify', 'stage'].includes(command), 'Unsupported local-generation transport command.');
  const flags = new Map([['--sidecars', 'sidecarDirectory'], ['--candidate-registry', 'candidateRegistryDirectory'],
    ['--old-assets', 'oldAssetsDirectory'], ['--source-release-id', 'sourceReleaseId']]);
  const options = { ownedRoot: absolute(process.env.RUNNER_TEMP) };
  assert.ok(args.length % 2 === 0, 'Transport flags require exact values.');
  for (let index = 0; index < args.length; index += 2) {
    const name = flags.get(args[index]);
    assert.ok(name && !Object.hasOwn(options, name), 'Unknown or duplicate transport flag.');
    options[name] = args[index + 1];
  }
  assert.ok(/^[1-9][0-9]*$/.test(options.sourceReleaseId ?? ''), 'Transport draft ID must be canonical decimal.');
  options.sourceReleaseId = Number(options.sourceReleaseId);
  const result = await (command === 'stage' ? stageLegacyLocalTransport(options) : verifyLegacyLocalTransport(options));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
