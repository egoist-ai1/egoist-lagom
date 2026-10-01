import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve('.');
const script = path.join(root, 'tests/windows-installer-diagnostics.ps1');
const ordinary = path.join(root, 'tests/windows-ordinary-gui.ps1');
const quote = value => String(value).replaceAll("'", "''");
const shell = process.env.LAGOM_TEST_POWERSHELL || 'pwsh';
const fixtureRoot = process.env.LAGOM_TEST_TEMP || process.env.EGOIST_RELEASE_TEST_DIR;
function run(body) {
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop';. '" + quote(script) + "' -LibraryOnly;\n" + body], {
    encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  return JSON.parse(child.stdout);
}
const selection = {
  ORDINARY_GUI_DIAGNOSTIC: 'true', INSTALLER_DIAGNOSTICS: 'true',
  DIAGNOSTIC_RELEASE_ID: '401228861', DIAGNOSTIC_VARIANT: 'candidate',
  DIAGNOSTIC_ALL_VERSIONS: 'false', DIAGNOSTIC_LEGACY_ONLY: 'false',
  CORE_CONFIGURATION_DIAGNOSTIC: 'false', DIAGNOSTIC_LEGACY_RESTORE: 'false',
  PACKAGE_CANDIDATE: 'false', NATIVE_ACCEPTANCE: 'false',
  SIGNED_LEGACY_RELEASE_ID: '', SIGNED_CURRENT_ONLY: 'false',
};
function selectionBody(value) {
  return "$selection=@{};$data='" + quote(JSON.stringify(value)) +
    "'|ConvertFrom-Json;foreach($property in $data.PSObject.Properties){$selection[$property.Name]=$property.Value};";
}
function git(directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  return result.stdout.trim();
}
const allowed = [
  '.github/workflows/ci.yml', 'tests/windows-installer-diagnostics.ps1',
  'tests/windows-ordinary-gui.cs', 'tests/windows-ordinary-gui.ps1',
  'tests/ordinary-gui-diagnostic-contract.test.mjs', 'tests/ordinary-gui-diagnostics.test.mjs',
];
async function repository() {
  assert.ok(fixtureRoot && path.isAbsolute(fixtureRoot), 'Absolute own LAGOM_TEST_TEMP or EGOIST_RELEASE_TEST_DIR required.');
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'ordinary-diagnostic-contract-'));
  git(directory, ['init', '--quiet']);
  for (const relative of [...allowed, 'src/production.js', 'global.json', 'resources/release/root-public-key.pem']) {
    const file = path.join(directory, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'original fixture\n');
  }
  commit(directory, 'artifact fixture');
  return { directory, artifact: git(directory, ['rev-parse', 'HEAD']), tree: git(directory, ['rev-parse', 'HEAD^{tree}']) };
}
function commit(directory, message) {
  git(directory, ['add', '--all']);
  git(directory, ['-c', 'user.name=Diagnostic Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', message]);
}
async function dispose(fixture) {
  assert.equal(path.dirname(fixture.directory), path.resolve(fixtureRoot));
  await fs.rm(fixture.directory, { recursive: true, force: true });
}
function sourceProof(fixture, harness, { source = fixture.artifact, tree = fixture.tree, refuse = false } = {}) {
  const manifest = JSON.stringify({ product: 'Egoist Lagom', version: '3.8.0', source: { commit: source, tree } });
  return run("$manifest='" + quote(manifest) + "'|ConvertFrom-Json;$refused=$false;$proof=$null;" +
    "try{$proof=Get-OrdinaryGuiDiagnosticSourceProof -Project '" + quote(fixture.directory) +
    "' -Manifest $manifest -HostedCommit '" + harness + "'}catch{if(-not " + (refuse ? '$true' : '$false') + "){throw};$refused=$true};" +
    "@{refused=$refused;proof=$proof}|ConvertTo-Json -Depth 8 -Compress");
}
test('ordinary diagnostic accepts only current authenticated selection and leaves false routes unchanged', () => {
  const result = run("Assert-OrdinaryGuiDiagnosticSelection -Selection @{ORDINARY_GUI_DIAGNOSTIC='false'};" +
    selectionBody(selection) + "Assert-OrdinaryGuiDiagnosticSelection -Selection $selection;" +
    "@{accepted=$true;normalRouteUnchanged=$true}|ConvertTo-Json -Compress");
  assert.deepEqual(result, { accepted: true, normalRouteUnchanged: true });
});
test('ordinary diagnostic refuses absent authentication and every conflicting launch flag', () => {
  const cases = [
    ['INSTALLER_DIAGNOSTICS', 'false'], ['DIAGNOSTIC_RELEASE_ID', ''],
    ['DIAGNOSTIC_RELEASE_ID', '1;evil'], ['DIAGNOSTIC_VARIANT', '3.7.9'],
    ['SIGNED_LEGACY_RELEASE_ID', '401228861'], ['ORDINARY_GUI_DIAGNOSTIC', 'TRUE'],
    ...['DIAGNOSTIC_ALL_VERSIONS', 'DIAGNOSTIC_LEGACY_ONLY', 'CORE_CONFIGURATION_DIAGNOSTIC',
      'DIAGNOSTIC_LEGACY_RESTORE', 'PACKAGE_CANDIDATE', 'NATIVE_ACCEPTANCE', 'SIGNED_CURRENT_ONLY']
      .map(name => [name, 'true']),
  ];
  for (const [name, value] of cases) {
    const result = run(selectionBody({ ...selection, [name]: value }) +
      "$refused=$false;try{Assert-OrdinaryGuiDiagnosticSelection -Selection $selection}catch{$refused=$true};" +
      "@{refused=$refused}|ConvertTo-Json -Compress");
    assert.equal(result.refused, true, name);
  }
});
test('actual Git proof accepts same source and the six explicit diagnostic files only', async () => {
  const fixture = await repository();
  try {
    let result = sourceProof(fixture, fixture.artifact);
    assert.equal(result.refused, false);
    assert.equal(result.proof.artifactSourceCommit, fixture.artifact);
    assert.equal(result.proof.harnessSourceCommit, fixture.artifact);
    assert.deepEqual(result.proof.changedPaths, []);
    for (const relative of allowed) await fs.appendFile(path.join(fixture.directory, relative), 'diagnostic fixture\n');
    commit(fixture.directory, 'harness fixture');
    const harness = git(fixture.directory, ['rev-parse', 'HEAD']);
    result = sourceProof(fixture, harness);
    assert.equal(result.refused, false);
    assert.equal(result.proof.artifactSourceTree, fixture.tree);
    assert.equal(result.proof.harnessSourceTree, git(fixture.directory, ['rev-parse', 'HEAD^{tree}']));
    assert.deepEqual(result.proof.changedPaths, [...allowed].sort());
  } finally { await dispose(fixture); }
});
test('actual Git proof rejects production, toolchain, trust and unreviewed test changes', async () => {
  const fixture = await repository();
  try {
    for (const relative of ['src/production.js', 'global.json', 'resources/release/root-public-key.pem', 'tests/unreviewed.ps1']) {
      await fs.writeFile(path.join(fixture.directory, relative), 'forbidden fixture\n');
      commit(fixture.directory, 'forbidden fixture');
      assert.equal(sourceProof(fixture, git(fixture.directory, ['rev-parse', 'HEAD']), { refuse: true }).refused, true, relative);
      git(fixture.directory, ['reset', '--hard', fixture.artifact]);
    }
  } finally { await dispose(fixture); }
});
test('actual Git proof rejects false artifact tree, false hosted commit and dirty harness', async () => {
  const fixture = await repository();
  try {
    assert.equal(sourceProof(fixture, fixture.artifact, { tree: 'a'.repeat(40), refuse: true }).refused, true);
    assert.equal(sourceProof(fixture, 'b'.repeat(40), { refuse: true }).refused, true);
    assert.equal(sourceProof(fixture, fixture.artifact, { source: 'invalid', refuse: true }).refused, true);
    await fs.appendFile(path.join(fixture.directory, allowed[0]), 'uncommitted fixture\n');
    assert.equal(sourceProof(fixture, fixture.artifact, { refuse: true }).refused, true);
  } finally { await dispose(fixture); }
});
test('normal source defaults to artifact; explicit ordinary diagnostic harness is separately validated', () => {
  const result = run(". '" + quote(ordinary) + "' -OrdinaryGuiLibraryOnly;" +
    "$artifact='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';$harness='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';" +
    "$normal=Resolve-OrdinaryGuiHarnessSourceCommit -ExpectedSourceCommit $artifact;" +
    "$diagnostic=Resolve-OrdinaryGuiHarnessSourceCommit -ExpectedSourceCommit $artifact -ExpectedHarnessSourceCommit $harness;" +
    "$refused=$false;try{Resolve-OrdinaryGuiHarnessSourceCommit -ExpectedSourceCommit $artifact -ExpectedHarnessSourceCommit 'invalid'|Out-Null}catch{$refused=$true};" +
    "@{normal=$normal;diagnostic=$diagnostic;invalidRefused=$refused}|ConvertTo-Json -Compress");
  assert.equal(result.normal, 'a'.repeat(40));
  assert.equal(result.diagnostic, 'b'.repeat(40));
  assert.equal(result.invalidRefused, true);
});
test('ordinary diagnostic refuses physical host before reading candidate or fetching Git', () => {
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script,
    '-OrdinaryGuiDiagnostic', '-SignedCandidateAssetsDirectory', 'C:/nonexistent-ordinary-diagnostic'], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' },
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Native acceptance host guard refused before mutation/);
  assert.doesNotMatch(result.stderr, /nonexistent-ordinary-diagnostic|git fetch|diagnostic-source-fetch|DOTNET_INSTALL_DIR/);
});
test('workflow wires authenticated current-only diagnostics and keeps normal acceptance source binding', async () => {
  const yaml = await fs.readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(yaml, /ordinary_gui_diagnostic:\s*\n\s*description:[^\n]*\n\s*type: boolean/);
  assert.match(yaml, /Assert-OrdinaryGuiDiagnosticSelection -Selection/);
  assert.match(yaml, /inputs\.core_configuration_diagnostic \|\| inputs\.legacy_baseline_restore \|\| inputs\.ordinary_gui_diagnostic/);
  assert.match(yaml, /-OrdinaryGuiDiagnostic/);
  assert.match(yaml, /sourceCommit=\$env:GITHUB_SHA/);
  const source = await fs.readFile(script, 'utf8');
  assert.match(source, /-ExpectedHarnessSourceCommit \$env:GITHUB_SHA/);
  assert.match(source, /releaseReady=\$false/);
  assert.match(source, /'verify-payload'/);
  assert.match(source, /'--verify-only','true'/);
  assert.ok(source.indexOf("$gui=Invoke-NativeGui -Action 'provision-telegram' -Label 'gui-provision'") <
    source.indexOf('      Invoke-OrdinaryGuiLaunchDiagnostic -Receipt $receipt'), 'Exact preceding privileged GUI phase must precede ordinary launch.');
  assert.match(source, /\$script:Receipt=\$receipt;\$script:ReceiptPath=\$receiptPath/);
});

test('signed integrity copy preserves actual bytes and refuses mismatched hash or existing staging', async () => {
  const fixture = await repository();
  const original = path.join(fixture.directory, 'fixture-integrity.json');
  const bytes = Buffer.from('{"fixture":"signed-byte-copy","lineEnd":"actual"}\r\n');
  await fs.writeFile(original, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  try {
    const result = run(". '" + quote(path.join(root, 'tests/windows-production-acceptance.ps1')) + "' -LibraryOnly;" +
      "$copy=New-OrdinaryGuiDiagnosticIntegrityCopy -ManifestPath '" + quote(original) +
      "' -Workspace '" + quote(fixture.directory) + "' -ExpectedSha256 '" + hash + "' -RunId '123' -RunAttempt '1';" +
      "$overwriteRefused=$false;try{New-OrdinaryGuiDiagnosticIntegrityCopy -ManifestPath '" + quote(original) +
      "' -Workspace '" + quote(fixture.directory) + "' -ExpectedSha256 '" + hash +
      "' -RunId '123' -RunAttempt '1'|Out-Null}catch{$overwriteRefused=$true};" +
      "$hashRefused=$false;try{New-OrdinaryGuiDiagnosticIntegrityCopy -ManifestPath '" + quote(original) +
      "' -Workspace '" + quote(fixture.directory) + "' -ExpectedSha256 '" + '0'.repeat(64) +
      "' -RunId '123' -RunAttempt '2'|Out-Null}catch{$hashRefused=$true};" +
      "@{copy=$copy;overwriteRefused=$overwriteRefused;hashRefused=$hashRefused}|ConvertTo-Json -Depth 6 -Compress");
    assert.equal(result.overwriteRefused, true);
    assert.equal(result.hashRefused, true);
    assert.equal(result.copy.copy.sha256.toLowerCase(), hash);
    assert.equal(result.copy.original.sha256.toLowerCase(), hash);
    assert.equal(result.copy.copy.bytes, bytes.length);
    assert.deepEqual(await fs.readFile(result.copy.path), bytes);
    await assert.rejects(fs.stat(path.join(fixture.directory, 'dist/ordinary-diag-123-2')), { code: 'ENOENT' });
  } finally { await dispose(fixture); }
});
test('original ordinary failure is retained while a separately instrumented follow-up still executes', async () => {
  const fixture = await repository();
  await fs.writeFile(path.join(fixture.directory, 'release-manifest.json'), '{"integrityManifestSha256":"' + 'a'.repeat(64) + '"}');
  try {
    const result = run("$SignedCandidateAssetsDirectory='" + quote(fixture.directory) + "';$script:SourceCommit='" + 'a'.repeat(40) +
      "';$env:GITHUB_SHA='" + 'b'.repeat(40) + "';" +
      "$script:ManifestPath='fixture-integrity';" +
      "function New-OrdinaryGuiDiagnosticIntegrityCopy {return @{path='fixture-staged-integrity'}};" +
      "function Invoke-OrdinaryGuiDiagnosticAttempt {param($Receipt,$Label,[bool]$CaptureStandardStreams);" +
      "if($Label -eq 'original'){return @{result='failed';error='actual-boundary-fixture';label=$Label;captureStandardStreams=$CaptureStandardStreams}};" +
      "return @{result='ordinary-launch-and-normal-close-diagnostic-only';label=$Label;captureStandardStreams=$CaptureStandardStreams}};" +
      "$receipt=@{};$failed=$false;try{Invoke-OrdinaryGuiLaunchDiagnostic -Receipt $receipt}catch{$failed=$true};" +
      "@{failed=$failed;diagnostic=$receipt.ordinaryGui}|ConvertTo-Json -Depth 7 -Compress");
    assert.equal(result.failed, true);
    assert.equal(result.diagnostic.releaseReady, false);
    assert.equal(result.diagnostic.result, 'original-launch-failed-with-instrumented-followup');
    assert.equal(result.diagnostic.error, 'actual-boundary-fixture');
    assert.deepEqual(result.diagnostic.attempts.map(attempt => attempt.label), ['original', 'instrumented']);
    assert.deepEqual(result.diagnostic.attempts.map(attempt => attempt.captureStandardStreams), [false, true]);
  } finally { await dispose(fixture); }
});
test('successful original-style ordinary observation does not create an instrumented attempt', async () => {
  const fixture = await repository();
  await fs.writeFile(path.join(fixture.directory, 'release-manifest.json'), '{"integrityManifestSha256":"' + 'a'.repeat(64) + '"}');
  try {
    const result = run("$SignedCandidateAssetsDirectory='" + quote(fixture.directory) + "';$script:SourceCommit='" + 'a'.repeat(40) +
      "';$env:GITHUB_SHA='" + 'b'.repeat(40) + "';" +
      "$script:ManifestPath='fixture-integrity';" +
      "function New-OrdinaryGuiDiagnosticIntegrityCopy {return @{path='fixture-staged-integrity'}};" +
      "function Invoke-OrdinaryGuiDiagnosticAttempt {param($Receipt,$Label,[bool]$CaptureStandardStreams);" +
      "if($Label -ne 'original' -or $CaptureStandardStreams){throw 'Unexpected instrumentation'};" +
      "return @{result='ordinary-launch-and-normal-close-diagnostic-only';label=$Label;captureStandardStreams=$CaptureStandardStreams}};" +
      "$receipt=@{};Invoke-OrdinaryGuiLaunchDiagnostic -Receipt $receipt;" +
      "$receipt.ordinaryGui|ConvertTo-Json -Depth 7 -Compress");
    assert.equal(result.releaseReady, false);
    assert.equal(result.result, 'original-ordinary-launch-and-normal-close-diagnostic-only');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].captureStandardStreams, false);
    assert.match(result.cause, /not reproduced/);
  } finally { await dispose(fixture); }
});

test('missing authenticated Git object fetches only the exact pinned commit and rechecks its tree', async () => {
  const harness = await repository();
  const artifact = await repository();
  git(artifact.directory, ['-c', 'user.name=Diagnostic Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'distinct artifact identity']);
  artifact.artifact = git(artifact.directory, ['rev-parse', 'HEAD']);
  artifact.tree = git(artifact.directory, ['rev-parse', 'HEAD^{tree}']);
  git(harness.directory, ['remote', 'add', 'origin', 'https://github.com/egoist-ai1/egoist-lagom']);
  try {
    const manifest = JSON.stringify({ product: 'Egoist Lagom', version: '3.8.0',
      source: { commit: artifact.artifact, tree: artifact.tree } });
    const result = run(". '" + quote(path.join(root, 'tests/windows-production-acceptance.ps1')) + "' -LibraryOnly;" +
      "$script:fetches=0;function Invoke-NativeBounded {param($Executable,$Arguments,$Label,$TimeoutSeconds);" +
      "if($Label -ne 'diagnostic-source-fetch' -or $TimeoutSeconds -ne 60 -or " +
      "($Arguments -join '|') -cne '-C|" + quote(harness.directory) + "|fetch|--no-tags|--depth=1|origin|" + artifact.artifact + "'){throw 'Unexpected fetch contract'};" +
      "$script:fetches++;& git -C '" + quote(harness.directory) + "' fetch --quiet --no-tags --depth=1 '" +
      quote(artifact.directory) + "' '" + artifact.artifact + "';if($LASTEXITCODE -ne 0){throw 'Own fixture fetch failed'}};" +
      "$manifest='" + quote(manifest) + "'|ConvertFrom-Json;" +
      "$proof=Get-OrdinaryGuiDiagnosticSourceProof -Project '" + quote(harness.directory) +
      "' -Manifest $manifest -HostedCommit '" + harness.artifact + "';" +
      "@{fetches=$script:fetches;proof=$proof}|ConvertTo-Json -Depth 7 -Compress");
    assert.equal(result.fetches, 1);
    assert.equal(result.proof.artifactSourceCommit, artifact.artifact);
    assert.equal(result.proof.artifactSourceTree, artifact.tree);
    assert.equal(result.proof.harnessSourceCommit, harness.artifact);
    assert.deepEqual(result.proof.changedPaths, []);
  } finally { await dispose(harness); await dispose(artifact); }
});
