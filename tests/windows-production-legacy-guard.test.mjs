import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { authenticateLegacyRegistry, authenticateLegacyManifest, assertLegacyRegistrySuccessor,
  assertSignedCandidateSource, decodeLegacySignature, officialLegacyRelease,
  authenticateOfficialLegacyManifest, assertCandidateSupportsLegacyVersion } from './windows-production-legacy-upgrade.mjs';

const artifacts = path.resolve('docs/reliability-3.7.9/network/public-artifacts/candidate');
const root = fs.readFileSync('resources/release/root-public-key.pem');
const registryBytes = fs.readFileSync(path.join(artifacts, 'release-key-registry.json'));
const registrySignature = fs.readFileSync(path.join(artifacts, 'release-key-registry.json.sig'));
const manifestBytes = fs.readFileSync(path.join(artifacts, 'release-manifest.json'));
const manifestSignature = fs.readFileSync(path.join(artifacts, 'release-manifest.json.sig'));
// Original public v3.7.9 bytes, including the final LF; its registry equals the existing real v3.7.8 fixture.
const manifest379Bytes = Buffer.from(`{
  "schemaVersion": 2,
  "channel": "stable",
  "version": "3.7.9",
  "tag": "v3.7.9",
  "installerName": "EgoistShield-Setup-3.7.9.exe",
  "canonicalDownloadUrl": "https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.7.9/EgoistShield-Setup-3.7.9.exe",
  "size": 206521508,
  "sha256": "eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6",
  "sha512": "46ac50c71106432eb09d3cf8e47e6b7b402c4b7e1746214ed72dace268dc421b9d369faf37f10392e78c44039dd1a2f0f4415b6681bdc5cf4f0c6b3a83b041bc",
  "githubDigest": "sha256:eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6",
  "minimumAppVersion": "3.7.8",
  "keyId": "release-2026-09-recovery",
  "authenticodeStatus": "not-signed",
  "licenseVersion": "1.0",
  "publishedAt": "2026-09-29T16:08:58.508Z"
}
`.replaceAll('\r\n', '\n'));
const manifest379Signature = Buffer.from('TjlBOExkckVQeWlnbVc2YWwrRkdDS1UzM1NSTDg0VGpxNFd1dUFpRjB5Z0hnYkMyb0h6dU1JdzB1Z0RMUU1HSUQ4bEs2SDFSYndGSGRNNlhEUXIxQ3c9PQo=', 'base64');

test('official legacy versions select separate immutable installer/helper pins and reject aliases', () => {
  const old378 = officialLegacyRelease('3.7.8'), old379 = officialLegacyRelease('3.7.9');
  assert.equal(old378.installerSha256, JSON.parse(manifestBytes).sha256);
  assert.equal(old379.installerSha256, JSON.parse(manifest379Bytes).sha256);
  assert.equal(old378.helperSha256, 'e33bca4550b6e130287c8bb2d5c0dccf30b76e033bf99520e81d6c2acda609f5');
  assert.equal(old379.helperSha256, 'f6c232fa15e4e8f1d78c149f973df8b807d58cabd8ef5898b8b5ce0d2279da8e');
  assert.notEqual(old378.helperSha256, old379.helperSha256);
  assert.ok(Object.isFrozen(old378) && Object.isFrozen(old379));
  assert.throws(() => { old378.helperSha256 = old379.helperSha256; });
  for (const invalid of [undefined, null, 378, {}, [], '', '3.7.7', '3.8.0', '3.7.80', '3.7.90',
    '3.7.8.0', 'v3.7.8', '3.7.8 ', ' 3.7.9', '3.7.9\n', '__proto__', 'constructor'])
    assert.throws(() => officialLegacyRelease(invalid), /oldVersion must be exactly/);
});

test('both original signed legacy manifests are accepted only for the explicitly selected version', () => {
  const trust = authenticateLegacyRegistry(registryBytes, registrySignature, root);
  assert.equal(manifest379Bytes.length, 785);
  assert.equal(authenticateOfficialLegacyManifest(manifestBytes, manifestSignature, trust, '3.7.8').version, '3.7.8');
  assert.equal(authenticateOfficialLegacyManifest(manifest379Bytes, manifest379Signature, trust, '3.7.9').version, '3.7.9');
  assert.throws(() => authenticateOfficialLegacyManifest(manifestBytes, manifestSignature, trust, '3.7.9'));
  assert.throws(() => authenticateOfficialLegacyManifest(manifest379Bytes, manifest379Signature, trust, '3.7.8'));
  assert.throws(() => authenticateOfficialLegacyManifest(manifestBytes, manifest379Signature, trust, '3.7.8'));
  assert.throws(() => authenticateOfficialLegacyManifest(manifest379Bytes, manifestSignature, trust, '3.7.9'));
  for (const invalid of [undefined, '', '3.7.7', 'v3.7.9', '3.7.9.0'])
    assert.throws(() => authenticateOfficialLegacyManifest(manifest379Bytes, manifest379Signature, trust, invalid), /oldVersion/);
});

test('candidate minimum version is compared with the selected legacy version, not a fixed 3.7.9', () => {
  // Pure compatibility boundary only; no candidate signature or installation is constructed.
  for (const oldVersion of ['3.7.8', '3.7.9'])
    for (const minimumAppVersion of ['0.0.0', '2.99.99', '3.6.100', '3.7.8'])
      assert.doesNotThrow(() => assertCandidateSupportsLegacyVersion({ minimumAppVersion }, oldVersion));
  assert.doesNotThrow(() => assertCandidateSupportsLegacyVersion({ minimumAppVersion: '3.7.9' }, '3.7.9'));
  assert.throws(() => assertCandidateSupportsLegacyVersion({ minimumAppVersion: '3.7.9' }, '3.7.8'), /excludes 3.7.8/);
  for (const oldVersion of ['3.7.8', '3.7.9'])
    for (const minimumAppVersion of ['3.7.10', '3.8.0', '4.0.0', undefined, '', '3.7.8x', '3.7.8.0', '9007199254740992.0.0'])
      assert.throws(() => assertCandidateSupportsLegacyVersion({ minimumAppVersion }, oldVersion));
  assert.throws(() => assertCandidateSupportsLegacyVersion({ minimumAppVersion: '3.7.8' }, undefined), /oldVersion/);
});

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
    if($ExpectedOldVersion -cne '3.7.9'){throw 'Default legacy version changed'};
    foreach($oldVersion in @('3.7.8','3.7.9')){
      . '${file}' -ExpectedOldVersion $oldVersion -LibraryOnly;
      if($ExpectedOldVersion -cne $oldVersion){throw 'Library import lost selected legacy version'};
      foreach($actual in @($oldVersion,($oldVersion+'.0'))){
        if(-not (Test-LegacyHarnessProductVersion $actual $oldVersion)){throw 'Exact ProductVersion refused'};
      };
      foreach($actual in @('3.7.7','3.8.0',($oldVersion+'0'),($oldVersion+'.1'),($oldVersion+'-fake'),($oldVersion+' '))){
        if(Test-LegacyHarnessProductVersion $actual $oldVersion){throw 'Incorrect ProductVersion accepted'};
      };
    };
    $acceptedInvalid=$false;
    try{. '${file}' -ExpectedOldVersion '3.7.7' -LibraryOnly;$acceptedInvalid=$true}catch{};
    if($acceptedInvalid){throw 'Unsupported legacy parameter accepted'};
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

function runInertLegacySnapshotBoundary(body) {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const file = path.resolve('tests/windows-production-legacy-upgrade.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';$WarningPreference='SilentlyContinue';
    function Get-CimInstance {throw 'Unexpected physical CIM query'}
    function Get-ScheduledTask {throw 'Unexpected physical Task query'}
    function New-Item {throw 'Unexpected physical mutation'}
    function Start-Sleep {throw 'Unexpected real sleep in inert boundary'}
    . '${file}' -LibraryOnly;
    $script:fixtureCimReads=0;$script:fixtureTaskReads=0;$script:fixtureSleeps=0;
    $script:fixtureServices=@(
      [pscustomobject]@{Name='ZuluRunner';StartMode='Auto';StartName='LocalSystem';PathName='C:\\Zulu.exe'},
      [pscustomobject]@{Name='EgoistShieldCore';StartMode='Auto';StartName='LocalSystem';PathName='C:\\Product.exe'},
      [pscustomobject]@{Name='AlphaRunner';StartMode='Manual';StartName=$null;PathName='C:\\Alpha.exe'},
      [pscustomobject]@{Name='egoistlagomFixture';StartMode='Auto';StartName='LocalSystem';PathName='C:\\Product2.exe'}
    );
    $script:fixtureTasks=@(
      [pscustomobject]@{TaskPath='\\Runner\\';TaskName='ZuluTask'},
      [pscustomobject]@{TaskPath='\\Product\\';TaskName='EgoistShieldRecovery'},
      [pscustomobject]@{TaskPath='\\Runner\\';TaskName='AlphaTask'}
    );
    ${body}
    @{ok=$true;boundary='inert protocol fixtures only';physicalQueries=0;physicalMutations=0}|ConvertTo-Json -Compress
  `;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
}

test('inert legacy snapshot retries a failed cold query, discards partial rows and preserves complete foreign inventory', { skip: process.platform !== 'win32' }, () => {
  runInertLegacySnapshotBoundary(`
    function Get-CimInstance {
      [CmdletBinding()]param([string]$ClassName,[string[]]$Property,[int]$OperationTimeoutSec)
      $script:fixtureCimReads++;
      if($ClassName -cne 'Win32_Service' -or ($Property -join ',') -cne 'Name,StartMode,StartName,PathName' -or $OperationTimeoutSec -ne 30 -or [string]$PSBoundParameters.ErrorAction -ne 'Stop'){throw 'CIM projection/timeout/error contract changed'};
      if($script:fixtureCimReads -eq 1){
        [pscustomobject]@{Name='PartialForeignRow';StartMode='Auto';StartName='LocalSystem';PathName='C:\\Partial.exe'};
        throw [TimeoutException]::new('inert cold-query timeout');
      };
      $script:fixtureServices
    }
    function Get-ScheduledTask {[CmdletBinding()]param()
      $script:fixtureTaskReads++;if([string]$PSBoundParameters.ErrorAction -ne 'Stop'){throw 'Task error contract changed'};$script:fixtureTasks
    }
    function Start-Sleep {param([int]$Milliseconds)
      if($Milliseconds -ne 1000){throw 'Retry delay is not bounded to1000ms'};$script:fixtureSleeps++
    }
    $snapshot=Get-LegacyForeignRegistrationSnapshot;
    if($script:fixtureCimReads -ne 2 -or $script:fixtureTaskReads -ne 1 -or $script:fixtureSleeps -ne 1){throw 'Cold query retry count changed'};
    if(($snapshot.services.Name -join ',') -cne 'AlphaRunner,ZuluRunner'){throw 'Partial/product rows leaked or foreign services dropped'};
    if(($snapshot.taskNames.TaskName -join ',') -cne 'AlphaTask,ZuluTask'){throw 'Foreign Tasks dropped or order changed'};
    if($snapshot.services[0].PathName -cne 'C:\\Alpha.exe' -or $snapshot.services[0].StartMode -cne 'Manual' -or $null -ne $snapshot.services[0].StartName){throw 'Foreign registration fields were altered'};
  `);
});

test('inert legacy snapshot never returns empty or partial state after failed, nonterminating, empty or malformed CIM reads', { skip: process.platform !== 'win32' }, () => {
  runInertLegacySnapshotBoundary(`
    function Get-CimInstance {[CmdletBinding()]param([string]$ClassName,[string[]]$Property,[int]$OperationTimeoutSec)
      $script:fixtureCimReads++;
      switch($script:fixtureFailure){
        'empty' {return}
        'malformed' {[pscustomobject]@{Name='BrokenRow'};return}
        'nonterminating' {Write-Error 'inert nonterminating CIM error';return}
        default {
          [pscustomobject]@{Name='PartialForeignRow';StartMode='Auto';StartName='LocalSystem';PathName='C:\\Partial.exe'};
          throw [TimeoutException]::new('inert persistent CIM timeout')
        }
      }
    }
    function Get-ScheduledTask {throw 'Task query continued after Unknown service inventory'}
    function Start-Sleep {param([int]$Milliseconds)
      if($Milliseconds -ne 1000){throw 'Retry delay changed'};$script:fixtureSleeps++
    }
    foreach($failure in @('terminating','nonterminating','empty','malformed')){
      $script:fixtureFailure=$failure;$script:fixtureCimReads=0;$script:fixtureSleeps=0;$snapshot=$null;$refused=$false;
      try{$snapshot=Get-LegacyForeignRegistrationSnapshot}catch{
        if($_.Exception.Message -notmatch 'Foreign service inventory is unknown after 2 bounded CIM attempts'){throw};$refused=$true
      };
      if(-not $refused -or $null -ne $snapshot -or $script:fixtureCimReads -ne 2 -or $script:fixtureSleeps -ne 1){throw ('Unknown was converted into a usable snapshot: '+$failure)};
    };
  `);
});

test('inert legacy snapshot keeps foreign service/Task comparison strict and refuses Task errors', { skip: process.platform !== 'win32' }, () => {
  runInertLegacySnapshotBoundary(`
    function Get-CimInstance {[CmdletBinding()]param([string]$ClassName,[string[]]$Property,[int]$OperationTimeoutSec)
      $script:fixtureCimReads++;$script:fixtureServices
    }
    function Get-ScheduledTask {[CmdletBinding()]param()
      $script:fixtureTaskReads++;if($script:fixtureTaskFailure){Write-Error 'inert unavailable Task inventory';return};$script:fixtureTasks
    }
    function Save-NativeReceipt {$script:fixtureSaved++}
    $script:fixtureTaskFailure=$false;$script:fixtureSaved=0;
    $script:Receipt=[ordered]@{beforeForeignRegistrations=(Get-LegacyForeignRegistrationSnapshot);checks=@()};
    Assert-LegacyForeignRegistrationsPreserved 'inert unchanged';
    if($script:fixtureSaved -ne 1 -or $script:fixtureCimReads -ne 2 -or $script:fixtureTaskReads -ne 2){throw 'Successful read was retried or strict success was not recorded'};
    foreach($field in @('Name','StartMode','StartName','PathName')){
      $original=$script:fixtureServices[0].$field;$script:fixtureServices[0].$field='changed';$refused=$false;
      try{Assert-LegacyForeignRegistrationsPreserved 'inert service change'}catch{if($_.Exception.Message -notmatch 'Unrelated service/task registrations changed'){throw};$refused=$true};
      $script:fixtureServices[0].$field=$original;if(-not $refused){throw ('Foreign service change was ignored: '+$field)}
    };
    foreach($field in @('TaskName','TaskPath')){
      $original=$script:fixtureTasks[0].$field;$script:fixtureTasks[0].$field='changed';$refused=$false;
      try{Assert-LegacyForeignRegistrationsPreserved 'inert Task change'}catch{if($_.Exception.Message -notmatch 'Unrelated service/task registrations changed'){throw};$refused=$true};
      $script:fixtureTasks[0].$field=$original;if(-not $refused){throw ('Foreign Task change was ignored: '+$field)}
    };
    $script:fixtureTaskFailure=$true;$snapshot=$null;$refused=$false;
    try{$snapshot=Get-LegacyForeignRegistrationSnapshot}catch{if($_.Exception.Message -notmatch 'inert unavailable Task inventory'){throw};$refused=$true};
    if(-not $refused -or $null -ne $snapshot -or $script:fixtureSaved -ne 1){throw 'Task unknown or changed registration was accepted'};
  `);
});

test('real legacy script and helper reject a non-hosted process before input or native mutation', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' };
  for (const oldVersion of ['3.7.8', '3.7.9']) {
    for (const mode of ['GuardOnly', 'Run']) {
      const native = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.resolve('tests/windows-production-legacy-upgrade.ps1'), '-Mode', mode, '-ExpectedOldVersion', oldVersion],
      { env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
      assert.notEqual(native.status, 0);
      assert.match(native.stderr, /Native legacy upgrade host guard refused before mutation/);
      assert.match(native.stderr, /GITHUB_ACTIONS/);
    }
  }
  const helper = spawnSync(process.execPath, [path.resolve('tests/windows-production-legacy-upgrade.mjs'), 'verify-assets', 'nonexistent.json'],
    { env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(helper.status, 0);
  assert.match(helper.stderr, /Disposable hosted runner guard refused/);
});
