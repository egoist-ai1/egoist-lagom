import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { authenticateCurrentCandidateBytes, authenticateLegacyRegistry,
  verifyCurrentCandidateInstaller, assertCurrentCandidateOptions } from './windows-production-legacy-upgrade.mjs';

const sha = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const detached = (bytes, key) => Buffer.from(sign(null, bytes, key).toString('base64') + '\n');
const now = Date.parse('2026-10-01T00:00:00.000Z');
const sourceCommit = 'a'.repeat(40);

function signedFixture({ candidateGeneration = '2026-09-30T00:00:00.000Z', mutateManifest } = {}) {
  const root = generateKeyPairSync('ed25519'), release = generateKeyPairSync('ed25519');
  const rootBytes = Buffer.from(root.publicKey.export({ type: 'spki', format: 'pem' }));
  const keys = [{ id: 'current-fixture-2026', algorithm: 'Ed25519', status: 'trusted',
    publicKeyPem: release.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2028-01-01T00:00:00.000Z' }];
  const bundledRegistryBytes = encode({ schemaVersion: 1, generatedAt: '2026-09-29T00:00:00.000Z', keys });
  const candidateRegistryBytes = encode({ schemaVersion: 1, generatedAt: candidateGeneration, keys });
  const installer = Buffer.alloc(4096, 0x41);
  const integrityBytes = encode({ product: 'Egoist Lagom', version: '3.8.0', source: { commit: sourceCommit },
    installer: { path: 'dist/EgoistShield-Setup-3.8.0.exe', sha256: sha(installer), bytes: installer.length } });
  const manifest = { schemaVersion: 2, channel: 'stable', version: '3.8.0', tag: 'v3.8.0',
    installerName: 'EgoistShield-Setup-3.8.0.exe',
    canonicalDownloadUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.0/EgoistShield-Setup-3.8.0.exe',
    size: installer.length, sha256: sha(installer), sha512: sha(installer, 'sha512'), githubDigest: `sha256:${sha(installer)}`,
    minimumAppVersion: '3.8.0', keyId: keys[0].id, authenticodeStatus: 'not-signed', licenseVersion: '1.0',
    publishedAt: '2026-09-30T12:00:00.000Z', sourceCommit, integrityManifestSha256: sha(integrityBytes) };
  mutateManifest?.(manifest);
  const manifestBytes = encode(manifest);
  return { installer, policy: { now, expectedRootSha256: sha(rootBytes) }, inputs: { rootBytes,
    bundledRegistryBytes, bundledRegistrySignature: detached(bundledRegistryBytes, root.privateKey),
    candidateRegistryBytes, candidateRegistrySignature: detached(candidateRegistryBytes, root.privateKey),
    manifestBytes, manifestSignature: detached(manifestBytes, release.privateKey), integrityBytes, sourceCommit } };
}

async function ownFixtureDirectory() {
  const base = process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
  assert.ok(base && path.isAbsolute(base), 'Task-owned LAGOM_TEST_TEMP or RUNNER_TEMP required.');
  return fs.mkdtemp(path.join(base, 'current-signed-assets-'));
}

test('current candidate authenticates genuinely signed generated fixture with explicit inert root pin', () => {
  const fixture = signedFixture();
  const result = authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy);
  assert.equal(result.kind, 'current-candidate-authentication');
  assert.equal(result.candidate.version, '3.8.0');
  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.rootSha256, fixture.policy.expectedRootSha256);
  assert.equal(result.bundledRegistrySha256, sha(fixture.inputs.bundledRegistryBytes));
  assert.equal(result.candidateRegistrySha256, sha(fixture.inputs.candidateRegistryBytes));
  assert.equal(result.candidateManifestSha256, sha(fixture.inputs.manifestBytes));
  assert.equal(result.integrityManifestSha256, sha(fixture.inputs.integrityBytes));
});

test('project default root pin rejects generated fixture rather than importing a test trust override', () => {
  const fixture = signedFixture();
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs), /not the pinned root/);
});

test('real bundled public registry authenticates under the immutable real project root', async () => {
  const [root, registry, signature] = await Promise.all(['root-public-key.pem', 'release-key-registry.json', 'release-key-registry.json.sig']
    .map(name => fs.readFile(path.resolve('resources/release', name))));
  assert.equal(sha(root), '30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7');
  assert.equal(authenticateLegacyRegistry(registry, signature, root).digest, sha(registry));
});

test('current signed manifest tampering fails Ed25519 verification over original bytes', () => {
  const fixture = signedFixture();
  const manifest = JSON.parse(fixture.inputs.manifestBytes);
  manifest.licenseVersion = '2.0';
  fixture.inputs.manifestBytes = encode(manifest);
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy), /manifest signature failed/);
});

test('current signed integrity binding rejects changed original bytes', () => {
  const fixture = signedFixture();
  fixture.inputs.integrityBytes = Buffer.concat([fixture.inputs.integrityBytes, Buffer.from(' ')]);
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy), /integrity-file digest differs/);
});

test('current signed source commit cannot be substituted', () => {
  const fixture = signedFixture({ mutateManifest: value => { value.sourceCommit = 'b'.repeat(40); } });
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy), /source commit differs/);
});

test('genuinely root-signed candidate registry rollback is rejected against bundled baseline', () => {
  const fixture = signedFixture({ candidateGeneration: '2026-09-28T00:00:00.000Z' });
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy), /Registry rollback refused/);
});

test('current candidate registry tampering fails pinned-root signature verification', () => {
  const fixture = signedFixture();
  fixture.inputs.candidateRegistryBytes = Buffer.concat([fixture.inputs.candidateRegistryBytes, Buffer.from(' ')]);
  assert.throws(() => authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy), /registry signature/);
});

test('current options bind exact source and own runner paths without accepting legacy or trust overrides', () => {
  const runnerTemp = process.env.LAGOM_TEST_TEMP || process.env.RUNNER_TEMP;
  assert.ok(runnerTemp && path.isAbsolute(runnerTemp));
  const work = path.join(runnerTemp, 'lagom-legacy-native-1-1');
  const context = { runnerTemp, work, sourceCommit };
  const options = { candidateAssets: path.join(runnerTemp, 'current-candidate'),
    integrityPath: path.join(runnerTemp, 'integrity.json'), output: path.join(work, 'current.json'), sourceCommit };
  assert.doesNotThrow(() => assertCurrentCandidateOptions(options, context));
  for (const change of [
    value => { value.sourceCommit = 'b'.repeat(40); },
    value => { value.oldAssets = 'MUST_NOT_READ'; },
    value => { value.oldVersion = '3.7.9'; },
    value => { value.expectedRootSha256 = '0'.repeat(64); },
    value => { value.candidateAssets = path.resolve(runnerTemp, '..', 'outside-candidate'); },
    value => { value.integrityPath = path.resolve(runnerTemp, '..', 'outside-integrity.json'); },
    value => { value.output = path.join(runnerTemp, 'outside-current-output.json'); },
    value => { value.candidateAssets = 'relative-candidate'; },
  ]) {
    const invalid = { ...options }; change(invalid);
    assert.throws(() => assertCurrentCandidateOptions(invalid, context));
  }
});

test('actual task-local installer stream verifies SHA256, SHA512 and byte count', async () => {
  const fixture = signedFixture(), directory = await ownFixtureDirectory();
  const result = authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy);
  const file = path.join(directory, result.candidate.installerName);
  await fs.writeFile(file, fixture.installer, { flag: 'wx' });
  const actual = await verifyCurrentCandidateInstaller(file, result.candidate);
  assert.deepEqual(actual, { sha256: sha(fixture.installer), sha512: sha(fixture.installer, 'sha512'), bytes: 4096 });
  const tampered = Buffer.from(fixture.installer); tampered[0] ^= 1;
  await fs.writeFile(file, tampered);
  await assert.rejects(verifyCurrentCandidateInstaller(file, result.candidate), /installer differs/);
});

for (const field of ['sha256', 'sha512', 'size']) {
  test(`current installer streaming refuses authenticated ${field} mismatch`, async () => {
    const fixture = signedFixture(), directory = await ownFixtureDirectory();
    const result = authenticateCurrentCandidateBytes(fixture.inputs, fixture.policy);
    const file = path.join(directory, result.candidate.installerName);
    await fs.writeFile(file, fixture.installer, { flag: 'wx' });
    result.candidate[field] = field === 'size' ? 4097 : '0'.repeat(field === 'sha256' ? 64 : 128);
    await assert.rejects(verifyCurrentCandidateInstaller(file, result.candidate), /installer differs/);
  });
}

test('current CLI refuses physical/non-hosted process before options read or output write', async () => {
  const directory = await ownFixtureDirectory();
  const options = path.join(directory, 'must-not-read.options.json'), output = path.join(directory, 'must-not-write.json');
  await fs.writeFile(options, 'INVALID_INPUT_MUST_NOT_BE_PARSED', { flag: 'wx' });
  const result = spawnSync(process.execPath, [path.resolve('tests/windows-production-legacy-upgrade.mjs'), 'verify-current-assets', options],
    { env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' }, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, process.platform === 'win32' ? /Disposable hosted runner guard refused/ : /win32/);
  assert.doesNotMatch(result.stderr, /INVALID_INPUT_MUST_NOT_BE_PARSED|SyntaxError|ENOENT/);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
});
