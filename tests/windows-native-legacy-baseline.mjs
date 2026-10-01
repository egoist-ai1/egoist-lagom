import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authenticateLegacyRegistry, authenticateOfficialLegacyManifest, officialLegacyRelease } from './windows-production-legacy-upgrade.mjs';
import { acceptanceEnvironmentErrors } from './windows-production-acceptance.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const originalCleanupSha256 = 'c7eca1981c0aa2eb237f1db29c0acfa2fe62a0756ef292efb97339815011f44e';
const bounds = Object.freeze({ files: 8192, expanded: 2 * 1024 ** 3, file: 512 * 1024 ** 2, listing: 8 * 1024 ** 2 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function safeArchivePath(value) {
  assert.equal(typeof value, 'string');
  const relative = value.replaceAll('\\', '/');
  assert.ok(relative && relative.length <= 512 && !relative.startsWith('/') && !/[\x00-\x1f:*?"<>|]/.test(relative), 'Unsafe archive path.');
  for (const part of relative.split('/')) {
    assert.ok(part && part !== '.' && part !== '..' && !/[ .]$/.test(part), 'Unsafe archive path component.');
    assert.ok(!/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(part), 'Windows device path refused.');
    assert.ok(!part.includes('$') || part === '$INSTDIR' || part === '$PLUGINSDIR', 'Unresolved NSIS path refused.');
  }
  assert.ok(!relative.split('/').slice(1).some(part => part.includes('$')), 'Nested NSIS variable refused.');
  return relative;
}

export function parseArchiveListing(text) {
  assert.ok(Buffer.byteLength(text) <= bounds.listing, 'Archive listing exceeds bound.');
  const records = text.replaceAll('\r\n', '\n').trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const values = {};
    for (const line of block.split('\n')) {
      const match = /^([^=]+?) = (.*)$/.exec(line);
      if (match) { assert.ok(!Object.hasOwn(values, match[1]), 'Duplicate archive field.'); values[match[1]] = match[2]; }
    }
    assert.ok(values.Path, 'Archive record has no path.');
    const archivePath = safeArchivePath(values.Path);
    assert.ok(!values['Symbolic Link'] && !values['Hard Link'] && !/(?:^|\s)l[rwx-]{9}/.test(values.Mode ?? '') && !/L/.test(values.Attributes ?? ''), 'Archive link refused.');
    const directory = values.Folder === '+' || /^D/.test(values.Attributes ?? '');
    assert.ok(directory || /^\d+$/.test(values.Size ?? '') || (archivePath === 'Uninstall Egoist Shield.exe' && values.Size === '' && /^LZMA:/.test(values.Method ?? '')), 'Unknown archive size refused.');
    const bytes = directory ? 0 : Number(values.Size);
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= bounds.file, 'Invalid archive size.');
    return { archivePath, directory, bytes, method: values.Method ?? '' };
  });
  assert.ok(records.length > 0 && records.length <= bounds.files, 'Archive entry count exceeds bound.');
  const unique = new Set(); let expanded = 0;
  for (const record of records) {
    const key = record.archivePath.normalize('NFC').toLowerCase();
    assert.ok(!unique.has(key), 'Case or Unicode archive path collision.'); unique.add(key);
    expanded += record.bytes;
  }
  assert.ok(expanded <= bounds.expanded, 'Archive expanded size exceeds bound.');
  return records;
}

export async function ordinary(file, directory = false) {
  assert.ok(path.isAbsolute(file), 'Absolute path required.');
  let current = path.resolve(file), first = true;
  while (current) {
    const stat = await fs.lstat(current);
    assert.ok(!stat.isSymbolicLink() && (!first || (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)), 'Ordinary non-linked path required.');
    const parent = path.dirname(current); if (parent === current) break;
    current = parent; first = false;
  }
}

export async function fileHashes(file) {
  await ordinary(file);
  const sha256 = createHash('sha256'), sha512 = createHash('sha512');
  for await (const chunk of createReadStream(file)) { sha256.update(chunk); sha512.update(chunk); }
  return { bytes: (await fs.stat(file)).size, sha256: sha256.digest('hex'), sha512: sha512.digest('hex') };
}

export async function inventoryTree(root) {
  await ordinary(root, true);
  const result = [], pending = ['']; let total = 0, visited = 0;
  while (pending.length) {
    const relative = pending.pop();
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      assert.ok(++visited <= bounds.files, 'Extracted tree count exceeds bound.');
      const name = safeArchivePath(relative ? relative + '/' + entry.name : entry.name);
      const file = path.join(root, ...name.split('/'));
      assert.ok(!entry.isSymbolicLink(), 'Extracted link refused.');
      if (entry.isDirectory()) { await ordinary(file, true); pending.push(name); }
      else {
        assert.ok(entry.isFile(), 'Special extracted entry refused.');
        const actual = await fileHashes(file);
        assert.ok(actual.bytes <= bounds.file, 'Extracted file exceeds bound.'); total += actual.bytes;
        assert.ok(total <= bounds.expanded, 'Extracted tree exceeds bound.');
        result.push({ path: name, bytes: actual.bytes, sha256: actual.sha256 });
      }
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function assertInventoryEqual(expected, actual) {
  assert.ok(Array.isArray(expected) && expected.length && expected.length <= bounds.files, 'Inventory count invalid.');
  assert.deepEqual(actual, expected, 'Complete payload inventory differs.');
}

async function boundedRead(file, maximum) {
  await ordinary(file); assert.ok((await fs.stat(file)).size <= maximum); return fs.readFile(file);
}

export async function authenticateOriginal(options) {
  const profile = officialLegacyRelease(options.originalVersion);
  await ordinary(options.installer);
  assert.equal(path.basename(options.installer), `EgoistShield-Setup-${profile.version}.exe`);
  const assets = path.dirname(options.installer);
  const root = await boundedRead(path.join(projectRoot, 'resources/release/root-public-key.pem'), 4096);
  assert.equal(digest(root), '30c069d617b6e6b1792e7fb6e0f73c17fb659676dd90f6a55d50bc537ac862e7');
  const trust = authenticateLegacyRegistry(await boundedRead(path.join(assets, 'release-key-registry.json'), 262144), await boundedRead(path.join(assets, 'release-key-registry.json.sig'), 1024), root);
  const manifest = authenticateOfficialLegacyManifest(await boundedRead(path.join(assets, 'release-manifest.json'), 131072), await boundedRead(path.join(assets, 'release-manifest.json.sig'), 1024), trust, profile.version);
  const actual = await fileHashes(options.installer);
  assert.deepEqual(actual, { bytes: manifest.size, sha256: manifest.sha256, sha512: manifest.sha512 });
  assert.deepEqual(actual, { bytes: options.expectedBytes, sha256: options.expectedSha256, sha512: options.expectedSha512 });
  return { profile, manifest, installer: actual, registrySha256: trust.digest, rootSha256: digest(root) };
}

export async function prepareOriginalExtraction(options) {
  const authenticated = await authenticateOriginal(options);
  await ordinary(options.workDirectory, true); await ordinary(options.sevenZipExecutable);
  const extracted = path.join(options.workDirectory, 'original-extracted');
  assert.equal(await fs.lstat(extracted).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Extraction directory must be fresh.');
  const listingResult = await execute(options.sevenZipExecutable, ['l', '-slt', '-ba', '-sccUTF-8', '--', options.installer], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: bounds.listing });
  const listing = parseArchiveListing(listingResult.stdout);
  await fs.writeFile(path.join(options.workDirectory, 'original-archive-listing.txt'), listingResult.stdout, { flag: 'wx' });
  await fs.mkdir(extracted);
  const extraction = await execute(options.sevenZipExecutable, ['x', '-y', '-sccUTF-8', '-o' + extracted, '--', options.installer], { encoding: 'utf8', windowsHide: true, timeout: 300000, maxBuffer: bounds.listing });
  await fs.writeFile(path.join(options.workDirectory, 'original-extraction.stdout.txt'), extraction.stdout, { flag: 'wx' });
  await fs.writeFile(path.join(options.workDirectory, 'original-extraction.stderr.txt'), extraction.stderr, { flag: 'wx' });
  const extractedInventory = await inventoryTree(extracted);
  const reconstructedArchiveEntries = [];
  const expectedFiles = listing.filter(entry => !entry.directory).map(entry => {
    if (entry.archivePath === 'Uninstall Egoist Shield.exe' && entry.bytes === 0) {
      const actual = extractedInventory.find(file => file.path === entry.archivePath);
      assert.ok(actual && actual.bytes >= 65536 && actual.bytes <= 2 * 1024 ** 2, 'Reconstructed NSIS uninstaller exceeds its reviewed bound.');
      reconstructedArchiveEntries.push({ ...actual, listedBytes: 0, reason: '7-Zip reconstructs the NSIS uninstaller from the authenticated Setup; this is not an original Setup execution.' });
      return { path: entry.archivePath, bytes: actual.bytes };
    }
    return { path: entry.archivePath, bytes: entry.bytes };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  assert.deepEqual(extractedInventory.map(({ path: file, bytes }) => ({ path: file, bytes })), expectedFiles, 'Extractor output differs from the complete validated archive listing.');
  const prefixed = listing.some(entry => entry.archivePath === '$INSTDIR/EgoistShield.exe');
  const payloadRoot = prefixed ? path.join(extracted, '$INSTDIR') : extracted;
  const payload = extractedInventory.filter(entry => prefixed ? entry.path.startsWith('$INSTDIR/') : !entry.path.startsWith('$PLUGINSDIR/')).map(entry => ({ ...entry, path: prefixed ? entry.path.slice('$INSTDIR/'.length) : entry.path }));
  assert.ok(payload.length > 20 && payload.some(entry => entry.path === 'EgoistShield.exe') && payload.some(entry => entry.path === 'resources/app.asar') && payload.some(entry => entry.path === 'resources/core-service/win-x64/EgoistShield.Service.exe'), 'Complete legacy payload is missing.');
  assert.equal(payload.find(entry => entry.path === 'resources/installer/owned-cleanup.ps1')?.sha256, originalCleanupSha256);
  assert.equal(payload.find(entry => entry.path === 'resources/installer/invoke-final-silent-reinstall.ps1')?.sha256, authenticated.profile.helperSha256);
  assert.ok(!payload.some(entry => entry.path === 'resources/installation.json'), 'Unexpected packaged installation identity; review the original generation.');
  const cleanup = await boundedRead(path.join(payloadRoot, 'resources/installer/owned-cleanup.ps1'), 262144);
  const text = cleanup.toString('utf8');
  const recipeMatch = /Write-Utf8NoBomFile -Path \(Join-Path \$installRoot "resources\\installation\.json"\) -Content \(@\{ id = \[Guid\]::NewGuid\(\)\.ToString\(\); version = "([0-9]+\.[0-9]+\.[0-9]+)" \} \| ConvertTo-Json -Compress\)/.exec(text);
  assert.ok(recipeMatch, 'Original generated-identity recipe differs.');
  const recipe = recipeMatch[0];
  return { kind: 'authenticated-original-extraction', originalVersion: options.originalVersion, originalSetupExecuted: false, authenticated, extractionTool: { path: options.sevenZipExecutable, ...(await fileHashes(options.sevenZipExecutable)) }, payloadRoot, archiveInventory: extractedInventory, reconstructedArchiveEntries, payload, payloadInventorySha256: digest(Buffer.from(JSON.stringify(payload))), sourceRecipe: { path: 'resources/installer/owned-cleanup.ps1', sha256: originalCleanupSha256, phase: 'PostInstall', recipe, originalMetadataVersion: recipeMatch[1], recipeSha256: digest(Buffer.from(recipe)) } };
}

export const prepareAuthenticatedOriginal = prepareOriginalExtraction;

async function verifyInstalled(options) {
  const prepared = JSON.parse(await boundedRead(options.preparedReceipt, 4 * 1024 ** 2));
  assert.equal(prepared.kind, 'authenticated-original-extraction');
  assert.equal(prepared.payloadInventorySha256, digest(Buffer.from(JSON.stringify(prepared.payload))));
  assert.equal(path.resolve(options.installationRoot).toLowerCase(), path.join(process.env.ProgramFiles, 'EgoistShield').toLowerCase());
  const actual = await inventoryTree(options.installationRoot);
  const metadata = options.generatedMetadata ?? [];
  assert.ok(metadata.length <= 1);
  if (metadata.length) {
    assert.equal(metadata[0].path, 'resources/installation.json');
    const identity = JSON.parse(await boundedRead(path.join(options.installationRoot, 'resources/installation.json'), 4096));
    assert.match(identity.id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
    assert.notEqual(identity.id, '00000000-0000-0000-0000-000000000000');
    assert.ok(identity.version === prepared.sourceRecipe.originalMetadataVersion || identity.version === prepared.originalVersion, 'Generated identity version must be the original recipe or actual original package version.');
  }
  assertInventoryEqual([...prepared.payload, ...metadata].sort((a, b) => a.path.localeCompare(b.path, 'en')), actual);
  return { kind: 'actual-restored-legacy-payload-readback', originalVersion: prepared.originalVersion, payload: prepared.payload, generatedMetadata: metadata, payloadInventorySha256: prepared.payloadInventorySha256, verifiedFiles: actual.length };
}

async function main() {
  const [command, optionsPath] = process.argv.slice(2);
  assert.ok(command === 'prepare' || command === 'verify-installed');
  assert.equal(process.platform, 'win32'); assert.deepEqual(acceptanceEnvironmentErrors(process.env), []);
  const options = JSON.parse(await boundedRead(optionsPath, 65536));
  assert.equal(options.sourceCommit, process.env.GITHUB_SHA);
  const output = path.resolve(options.output), root = path.resolve(process.env.RUNNER_TEMP);
  assert.ok(output.toLowerCase().startsWith(root.toLowerCase() + path.sep)); await ordinary(path.dirname(output), true);
  if (command === 'prepare') {
    for (const file of [options.installer, options.workDirectory]) assert.ok(path.resolve(file).toLowerCase().startsWith(root.toLowerCase() + path.sep), 'Baseline path escaped runner work.');
  }
  const result = await (command === 'prepare' ? prepareOriginalExtraction(options) : verifyInstalled(options));
  await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
