import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { authenticateLegacyRegistry, authenticateLegacyManifest, assertLegacyRegistrySuccessor,
  assertSignedCandidateSource, decodeLegacySignature } from './windows-production-legacy-upgrade.mjs';

const artifacts = path.resolve('docs/reliability-3.7.9/network/public-artifacts/candidate');
const root = fs.readFileSync('resources/release/root-public-key.pem');
const registryBytes = fs.readFileSync(path.join(artifacts, 'release-key-registry.json'));
const registrySignature = fs.readFileSync(path.join(artifacts, 'release-key-registry.json.sig'));
const manifestBytes = fs.readFileSync(path.join(artifacts, 'release-manifest.json'));
const manifestSignature = fs.readFileSync(path.join(artifacts, 'release-manifest.json.sig'));

test('legacy gate verifies original real signed metadata with the project pinned public root', () => {
  const trust = authenticateLegacyRegistry(registryBytes, registrySignature, root);
  const manifest = authenticateLegacyManifest(manifestBytes, manifestSignature, trust, '3.7.8');
  assert.equal(manifest.keyId, 'release-2026-09-recovery');
  assert.equal(manifest.sha256, '34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927');
  assertLegacyRegistrySuccessor(trust, trust);
  const changedRegistry = Buffer.from(registryBytes); changedRegistry[10] ^= 1;
  assert.throws(() => authenticateLegacyRegistry(changedRegistry, registrySignature, root));
  const changedManifest = Buffer.from(manifestBytes); changedManifest[10] ^= 1;
  assert.throws(() => authenticateLegacyManifest(changedManifest, manifestSignature, trust, '3.7.8'));
  assert.throws(() => authenticateLegacyManifest(manifestBytes, manifestSignature, trust, '3.8.0'));
  const changedRoot = Buffer.from(root); changedRoot[25] ^= 1;
  assert.throws(() => authenticateLegacyRegistry(registryBytes, registrySignature, changedRoot));
  for (const invalid of ['!', manifestSignature.toString().trim() + 'A', 'A'.repeat(85) + 'B==', 'A'.repeat(1025)])
    assert.throws(() => decodeLegacySignature(Buffer.from(invalid)));
});

test('legacy gate refuses registry rollback, key replacement and revoked-key revival', () => {
  const previous = authenticateLegacyRegistry(registryBytes, registrySignature, root);
  assert.throws(() => assertLegacyRegistrySuccessor(previous, { registry: { ...previous.registry, generatedAt: '2020-01-01' }, digest: previous.digest }));
  assert.throws(() => assertLegacyRegistrySuccessor(previous, { ...previous, digest: 'f'.repeat(64) }));
  const removed = structuredClone(previous); removed.registry.generatedAt = '2026-09-30'; removed.registry.keys.pop();
  assert.throws(() => assertLegacyRegistrySuccessor(previous, removed));
  const replaced = structuredClone(previous); replaced.registry.generatedAt = '2026-09-30';
  replaced.registry.keys[0].publicKeyPem = replaced.registry.keys[1].publicKeyPem;
  assert.throws(() => assertLegacyRegistrySuccessor(previous, replaced));
  const revoked = structuredClone(previous); revoked.registry.keys[0].status = 'revoked';
  assert.throws(() => assertLegacyRegistrySuccessor(revoked, previous));
});

test('pure source-binding boundary requires both signed fields and exact integrity bytes', () => {
  // Pure boundary data only. This does not create a signature or claim a native candidate.
  const commit = 'a'.repeat(40);
  const integrityBytes = Buffer.from(JSON.stringify({ product: 'Egoist Lagom', version: '3.8.0', source: { commit },
    installer: { bytes: 10000, sha256: 'b'.repeat(64), path: 'dist/EgoistShield-Setup-3.8.0.exe' } }));
  const manifest = { sourceCommit: commit, integrityManifestSha256: createHash('sha256').update(integrityBytes).digest('hex'),
    version: '3.8.0', installerName: 'EgoistShield-Setup-3.8.0.exe', size: 10000, sha256: 'b'.repeat(64) };
  assert.equal(assertSignedCandidateSource(manifest, integrityBytes, commit).source.commit, commit);
  for (const changed of [{ ...manifest, sourceCommit: undefined }, { ...manifest, sourceCommit: 'c'.repeat(40) },
    { ...manifest, integrityManifestSha256: undefined }, { ...manifest, integrityManifestSha256: 'd'.repeat(64) }])
    assert.throws(() => assertSignedCandidateSource(changed, integrityBytes, commit));
  assert.throws(() => assertSignedCandidateSource(manifest, Buffer.concat([integrityBytes, Buffer.from(' ')]), commit));
});

test('legacy PowerShell library import performs no native query or mutation and observer matches exact scope', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const file = path.resolve('tests/windows-production-legacy-upgrade.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    function Get-CimInstance { throw 'Unexpected native query during library import' }
    function Get-ScheduledTask { throw 'Unexpected Task query during library import' }
    function New-Item { throw 'Unexpected mutation during library import' }
    . '${file}' -LibraryOnly;
    $native='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    $stage='C:\\ProgramData\\EgoistShieldInstaller\\DeferredRuns\\'+('a'*32);
    $commandLine='powershell.exe -File "'+$stage+'\\invoke-final-silent-reinstall.ps1" -Watchdog -StageDirectory "'+$stage+'"';
    if(-not (Test-LegacyHarnessStageProcess ([pscustomobject]@{ExecutablePath=$native;CommandLine=$commandLine}) $stage $native)){throw 'Exact observer refused'};
    foreach($bad in @($commandLine.Replace('-Watchdog','-WatchdogExtra'),$commandLine.Replace('-File','-Command'),$commandLine.Replace($stage,$stage+'-foreign'))){
      if(Test-LegacyHarnessStageProcess ([pscustomobject]@{ExecutablePath=$native;CommandLine=$bad}) $stage $native){throw 'Foreign observer accepted'};
    };
    if(Test-LegacyHarnessStageProcess ([pscustomobject]@{ExecutablePath='C:\\foreign.exe';CommandLine=$commandLine}) $stage $native){throw 'Foreign image accepted'};
    @{libraryOnly=$true;liveScmMutations=0;liveDnsMutations=0;liveTaskMutations=0;liveRegistryMutations=0}|ConvertTo-Json -Compress
  `;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.equal(JSON.parse(result.stdout).libraryOnly, true);
});

test('real legacy script and helper reject a non-hosted process before input or native mutation', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' };
  const native = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('tests/windows-production-legacy-upgrade.ps1'), '-Mode', 'GuardOnly'], { env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(native.status, 0);
  assert.match(native.stderr, /Native legacy upgrade host guard refused before mutation/);
  assert.match(native.stderr, /GITHUB_ACTIONS/);
  const helper = spawnSync(process.execPath, [path.resolve('tests/windows-production-legacy-upgrade.mjs'), 'verify-assets', 'nonexistent.json'],
    { env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(helper.status, 0);
  assert.match(helper.stderr, /Disposable hosted runner guard refused/);
});
