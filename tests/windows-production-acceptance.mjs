import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getRawHeader } from '@electron/asar';
import { readElectronFuses, productionGuiFuses, productionWorkerFuses } from '../scripts/electron-fuses.mjs';

export function acceptanceEnvironmentErrors(environment) {
  const required = {
    GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Windows', GITHUB_REPOSITORY: 'egoist-ai1/egoist-lagom',
  };
  const errors = [];
  for (const [key, value] of Object.entries(required))
    if (environment[key] !== value) errors.push(key);
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'])
    if (!/^[1-9][0-9]*$/.test(environment[key] ?? '')) errors.push(key);
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? '')) errors.push('GITHUB_SHA');
  return errors;
}

export function relativePayloadPath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') ||
      relative.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('Invalid acceptance payload path.');
  const absolute = path.resolve(root, ...relative.split('/'));
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('Acceptance payload escaped its root.');
  return absolute;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertOrdinaryPath(file, directory = false) {
  let current = path.resolve(file);
  let first = true;
  while (current) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || first && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1))
      throw new Error('Acceptance requires an ordinary path: ' + current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    first = false;
  }
}

async function verifyPayload(options) {
  await assertOrdinaryPath(options.installRoot, true);
  await assertOrdinaryPath(options.integrity);
  const manifest = JSON.parse(await fs.readFile(options.integrity, 'utf8'));
  assert.equal(manifest.source.commit, options.sourceCommit);
  assert.equal(manifest.version, options.version);
  assert.ok(Array.isArray(manifest.payload) && manifest.payload.length > 20);
  const verified = [];
  for (const entry of manifest.payload) {
    const file = relativePayloadPath(options.installRoot, entry.path);
    await assertOrdinaryPath(file);
    assert.equal((await fs.stat(file)).size, entry.bytes, entry.path + ' length');
    assert.equal(await sha256(file), entry.sha256.toLowerCase(), entry.path + ' hash');
    verified.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256.toLowerCase() });
  }
  const inventoryPath = path.join(options.installRoot, 'resources', 'worker-host-integrity.json');
  const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
  assert.equal(inventory.owner, 'EgoistShield');
  assert.equal(inventory.packageVersion, options.version);
  assert.equal(inventory.guiFuseWire, productionGuiFuses);
  assert.equal(inventory.workerFuseWire, productionWorkerFuses);
  assert.ok(inventory.files.some(entry => entry.path === 'EgoistShield.Worker.exe'));
  const inventoryVerified = [];
  for (const entry of inventory.files) {
    const file = relativePayloadPath(options.installRoot, entry.path);
    await assertOrdinaryPath(file);
    assert.equal((await fs.stat(file)).size, entry.bytes);
    assert.equal(await sha256(file), entry.sha256.toLowerCase(), entry.path + ' worker inventory hash');
    inventoryVerified.push(entry.path);
  }
  const fuses = {};
  for (const [role, executable, expected] of [
    ['gui', 'EgoistShield.exe', productionGuiFuses], ['worker', 'EgoistShield.Worker.exe', productionWorkerFuses],
  ]) {
    const wire = readElectronFuses(await fs.readFile(path.join(options.installRoot, executable)));
    assert.equal(wire.wire, expected);
    fuses[role] = { version: wire.version, count: wire.count, wire: wire.wire };
  }
  const header = getRawHeader(path.join(options.installRoot, 'resources/app.asar')).headerString;
  const asarHeaderSha256 = createHash('sha256').update(header).digest('hex');
  assert.equal(asarHeaderSha256, manifest.electronFuses.asarHeaderSha256);
  return { verified, inventoryVerified, fuses, asarHeaderSha256 };
}

async function main() {
  assert.equal(process.platform, 'win32', 'Native Windows acceptance requires Windows.');
  const errors = acceptanceEnvironmentErrors(process.env);
  if (errors.length) throw new Error('Disposable hosted runner guard refused: ' + errors.join(', '));
  const [command, optionsPath] = process.argv.slice(2);
  if (command !== 'verify-payload') throw new Error('Unsupported acceptance command.');
  await assertOrdinaryPath(optionsPath);
  const options = JSON.parse(await fs.readFile(optionsPath, 'utf8'));
  const work = path.join(path.resolve(process.env.RUNNER_TEMP), `lagom-native-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
  assert.ok(path.resolve(optionsPath).startsWith(work + path.sep));
  assert.ok(path.resolve(options.output).startsWith(work + path.sep));
  const expectedRoot = path.join(process.env.ProgramFiles, 'EgoistShield');
  assert.equal(path.resolve(options.installRoot).toLowerCase(), path.resolve(expectedRoot).toLowerCase());
  assert.equal(options.sourceCommit, process.env.GITHUB_SHA);
  const result = await verifyPayload(options);
  await fs.writeFile(options.output, JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
