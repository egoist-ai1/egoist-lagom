import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { safeArchivePath, parseArchiveListing, inventoryTree, assertInventoryEqual, authenticateOriginal } from './windows-native-legacy-baseline.mjs';

function record(file, extra = '') { return `Path = ${file}\nSize = 4\nFolder = -\nAttributes = A\n${extra}`; }
async function removeOwnTemporary(root) {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && /^lagom-legacy-/.test(path.basename(root)), 'Temporary deletion escaped its own test directory.');
  await fs.rm(root, { recursive: true, force: true });
}

test('archive Windows path guard refuses traversal, ADS, devices, wildcard and NSIS-variable escapes', () => {
  for (const value of ['../evil.exe', 'resources/../evil', '/absolute', 'C:\\evil', '\\\\host\\share', 'a:stream', 'a/*', 'a/?', 'a\u0000b', 'a//b', 'a/CON.txt', 'a/NUL', 'a/COM1', 'a/LPT9.log', 'a/trailing.', 'a/trailing ', '$SYSDIR/evil', 'resources/$INSTDIR/evil']) {
    assert.throws(() => safeArchivePath(value), undefined, value);
  }
  assert.equal(safeArchivePath('$INSTDIR\\resources\\valid file.ps1'), '$INSTDIR/resources/valid file.ps1');
  assert.equal(safeArchivePath('$PLUGINSDIR/owned-cleanup.ps1'), '$PLUGINSDIR/owned-cleanup.ps1');
});

test('archive listing accepts original-style folders and rejects unsafe links, collisions and size ambiguity', () => {
  const accepted = parseArchiveListing('Path = $INSTDIR\nFolder = +\nAttributes = D\n\n' + record('$INSTDIR/EgoistShield.exe') + '\n' + record('$PLUGINSDIR/helper.ps1'));
  assert.equal(accepted.length, 3); assert.equal(accepted[0].directory, true);
  assert.equal(parseArchiveListing(record('resources/read-only.txt').replace('Attributes = A', 'Attributes = R'))[0].bytes, 4);
  assert.equal(parseArchiveListing('Path = Uninstall Egoist Shield.exe\nSize = \nMethod = LZMA:23\n')[0].bytes, 0);
  for (const value of [record('../escape'), record('safe', 'Symbolic Link = other\n'), record('safe', 'Hard Link = other\n'), record('safe', 'Mode = lrwxrwxrwx\n'), record('safe') + '\n' + record('SAFE'), record('safe').replace('Size = 4', 'Size = -1'), record('safe').replace('Size = 4', 'Size = '), record('safe').replace('Size = 4', 'Size = 9007199254740992'), record('safe') + 'Size = 5\n']) assert.throws(() => parseArchiveListing(value));
});

test('complete inert inventory detects changed, removed and added payload files and linked objects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-legacy-inventory-'));
  try {
    await fs.mkdir(path.join(root, 'resources'));
    await fs.writeFile(path.join(root, 'EgoistShield.exe'), 'inert fixture');
    await fs.writeFile(path.join(root, 'resources/valid file.txt'), 'original');
    const expected = await inventoryTree(root); assert.equal(expected.length, 2);
    assertInventoryEqual(expected, await inventoryTree(root));
    await fs.writeFile(path.join(root, 'resources/valid file.txt'), 'changed');
    assert.throws(() => assertInventoryEqual(expected, [{ ...expected[0], sha256: '0'.repeat(64) }, expected[1]]));
    assert.throws(() => assertInventoryEqual(expected, expected.slice(1)));
    assert.throws(() => assertInventoryEqual(expected, [...expected, { path: 'extra', bytes: 1, sha256: '0'.repeat(64) }]));
    assert.throws(() => assertInventoryEqual(expected, []));
    assert.throws(() => assertInventoryEqual(expected, expected.toReversed()));
    assert.notDeepEqual(await inventoryTree(root), expected);
    await fs.link(path.join(root, 'EgoistShield.exe'), path.join(root, 'linked.exe'));
    await assert.rejects(inventoryTree(root), /Ordinary non-linked/);
  } finally { await removeOwnTemporary(root); }
});

test('real signed original manifests cannot authorize changed installer bytes or a tampered manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-legacy-auth-refusal-'));
  try {
    const fixture = path.resolve('docs/reliability-3.7.9/network/public-artifacts/candidate');
    for (const name of ['release-manifest.json', 'release-manifest.json.sig', 'release-key-registry.json', 'release-key-registry.json.sig']) await fs.copyFile(path.join(fixture, name), path.join(root, name));
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'release-manifest.json'), 'utf8'));
    const installer = path.join(root, 'EgoistShield-Setup-3.7.8.exe');
    await fs.writeFile(installer, 'inert changed installer fixture');
    const options = { originalVersion: '3.7.8', installer, expectedSha256: manifest.sha256, expectedSha512: manifest.sha512, expectedBytes: manifest.size };
    await assert.rejects(authenticateOriginal(options), /deep-equal/);
    await fs.writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({ ...manifest, size: manifest.size + 1 }));
    await assert.rejects(authenticateOriginal(options), /signature/i);
  } finally { await removeOwnTemporary(root); }
});

test('native baseline CLI refuses the actual nonhosted local environment before touching the supplied work', { skip: process.env.RUNNER_ENVIRONMENT === 'github-hosted' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lagom-legacy-host-refusal-'));
  try {
    const result = spawnSync(process.execPath, [path.resolve('tests/windows-native-legacy-baseline.mjs'), 'prepare', path.join(root, 'nonexistent-options.json')], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.error, undefined); assert.deepEqual(await fs.readdir(root), []);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  } finally { await removeOwnTemporary(root); }
});

test('PowerShell library is pure and refuses the actual nonhosted host before restoration mutation', { skip: process.platform !== 'win32' || process.env.RUNNER_ENVIRONMENT === 'github-hosted' }, () => {
  const command = `. '${path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''")}' -LibraryOnly; . '${path.resolve('tests/windows-native-legacy-baseline.ps1').replaceAll("'", "''")}' -LibraryOnly; try { Invoke-RestoredLegacyBaseline -OriginalVersion '3.7.9' -AuthenticatedInstaller 'C:\\never\\EgoistShield-Setup-3.7.9.exe' -ExpectedInstallerSha256 ('0'*64) -ExpectedInstallerSha512 ('0'*128) -ExpectedInstallerBytes 1 -InstallationRoot 'C:\\never' -WorkDirectory 'C:\\never' -EvidenceDirectory 'C:\\never' -NodePath 'C:\\never' -PowerShellPath 'C:\\never'; exit 2 } catch { if($_.Exception.Message -notmatch 'host guard refused before mutation'){Write-Error $_;exit 3};Write-Output 'actual-local-host-refused';exit 0 }`;
  const result = spawnSync(process.env.SHIELD_ACCEPTANCE_POWERSHELL || 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /actual-local-host-refused/);
});

test('the compatibility recipe refuses the actual nonhosted host before any registry lookup', { skip: process.platform !== 'win32' || process.env.RUNNER_ENVIRONMENT === 'github-hosted' }, () => {
  const command = `. '${path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''")}' -LibraryOnly; . '${path.resolve('tests/windows-native-legacy-baseline.ps1').replaceAll("'", "''")}' -LibraryOnly; try { Set-RestoredOriginalCompatibility -OriginalVersion '3.7.9' -GuiPath 'C:\\never\\EgoistShield.exe'; exit 2 } catch { if($_.Exception.Message -notmatch 'host guard refused before registry lookup or mutation'){Write-Error $_;exit 3};Write-Output 'actual-local-registry-guard-refused';exit 0 }`;
  const result = spawnSync(process.env.SHIELD_ACCEPTANCE_POWERSHELL || 'pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /actual-local-registry-guard-refused/);
});
