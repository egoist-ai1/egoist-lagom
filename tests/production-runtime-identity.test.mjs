import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deriveWindowsSystemDirectory, checkNativeExecutionPrivilege, prepareRuntimeInstallRoot, verifyNativeRuntimeForExecution, runtimeExecutionEnvironment } from '../src/native-runtime-trust.js';
import { readElectronFuses, hardenElectronFuses, productionGuiFuses, productionWorkerFuses } from '../scripts/electron-fuses.mjs';
import { createWorkerHostInventory } from '../scripts/worker-host-integrity.mjs';

const work = process.env.LAGOM_TEST_TEMP;
const isolated = { skip: !work || !path.isAbsolute(work) ? 'Set LAGOM_TEST_TEMP to the task-owned work directory.' : false };
const windows = { skip: process.platform !== 'win32' ? 'Requires actual Windows token/NTFS boundary.' : false };
const validDlls = ['C:\\Windows\\System32\\ntdll.dll', 'C:\\Windows\\System32\\KERNEL32.DLL', 'C:\\Windows\\System32\\KernelBase.dll'];
const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const fuseBytes = (wire = '101100011', version = 1, count = 9) => Buffer.concat([Buffer.from('own-test-prefix'), sentinel, Buffer.from([version, count]), Buffer.from(wire), Buffer.from('own-test-suffix')]);
async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(work, 'ri-'));
  try { return await action(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('KnownDLL bootstrap accepts only a unanimous native System32 identity', () => {
  assert.equal(deriveWindowsSystemDirectory([...validDlls, 'C:\\Users\\fixture\\node.dll']), 'C:\\Windows\\System32');
  for (const paths of [null, [], validDlls.slice(1), [...validDlls, validDlls[0]], [...validDlls.slice(0, 2), 'C:\\attacker\\System32\\KernelBase.dll'], validDlls.map(value => value.replace('System32', 'SysWOW64')), validDlls.map(value => value.replace('C:\\', ''))])
    assert.throws(() => deriveWindowsSystemDirectory(paths));
});

test('actual Windows token probe returns a verified boolean', windows, async () => {
  assert.equal(typeof await checkNativeExecutionPrivilege(), 'boolean');
});

test('user runtime installation follows actual token and does not promise elevation', { skip: isolated.skip || windows.skip }, async () => fixture(async directory => {
  const actualAdmin = await checkNativeExecutionPrivilege();
  const input = { appRoot: directory, userDataDir: directory, runtimeKind: 'xray' };
  if (actualAdmin) await assert.rejects(prepareRuntimeInstallRoot(input), /обычном режиме/);
  else assert.deepEqual(await prepareRuntimeInstallRoot(input), { runtimeRoot: path.join(directory, 'runtime'), privileged: false });
  await assert.rejects(prepareRuntimeInstallRoot({ ...input, runtimeKind: 'arbitrary-exe' }), /Неизвестный/);
}));

test('privileged execution environment discards startup injection and resolves system paths from native lease', () => {
  const environment = runtimeExecutionEnvironment({ systemDirectory: 'C:\\Windows\\System32' }, { PATH: 'attacker', SystemRoot: 'D:\\fake', psmodulepath: 'attacker', NODE_OPTIONS: 'require', NODE_PATH: 'attacker', NODE_EXTRA_CA_CERTS: 'attacker', DOTNET_STARTUP_HOOKS: 'attacker', COMPLUS_ReadyToRun: 'attacker', CORECLR_ENABLE_PROFILING: '1', COR_PROFILER_PATH: 'attacker', OPENSSL_CONF: 'attacker', NORMAL_SETTING: 'preserved' });
  assert.equal(environment.PATH, 'C:\\Windows\\System32;C:\\Windows');
  assert.equal(environment.SystemRoot, 'C:\\Windows');
  assert.equal(environment.NORMAL_SETTING, 'preserved');
  for (const key of ['psmodulepath', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'DOTNET_STARTUP_HOOKS', 'COMPLUS_ReadyToRun', 'CORECLR_ENABLE_PROFILING', 'COR_PROFILER_PATH', 'OPENSSL_CONF']) assert.equal(Object.hasOwn(environment, key), false);
});

test('fuse parser rejects absent, duplicate, changed schema and malformed policy', () => {
  assert.equal(readElectronFuses(fuseBytes()).wire, '101100011');
  for (const bytes of [Buffer.alloc(50), Buffer.concat([fuseBytes(), fuseBytes()]), fuseBytes('101100011', 2), fuseBytes('101100011', 1, 10), fuseBytes('10110x011')]) assert.throws(() => readElectronFuses(bytes));
});

for (const [role, expected] of [['gui', productionGuiFuses], ['worker', productionWorkerFuses]]) test('fuse mutation has exact readback for ' + role, isolated, async () => fixture(async directory => {
  const file = path.join(directory, 'owned.exe'); await fs.writeFile(file, fuseBytes());
  const result = await hardenElectronFuses(file, role);
  assert.equal(result.before, '101100011'); assert.equal(result.wire, expected);
  assert.equal(readElectronFuses(await fs.readFile(file)).wire, expected);
}));

test('fuse mutation refuses hardlinked files and removed configured fuses', isolated, async () => fixture(async directory => {
  const original = path.join(directory, 'owned.exe'), alias = path.join(directory, 'alias.exe');
  await fs.writeFile(original, fuseBytes()); await fs.link(original, alias);
  await assert.rejects(hardenElectronFuses(alias, 'gui'), /ordinary unlinked/);
  await fs.unlink(alias); await fs.writeFile(original, fuseBytes('r01100011'));
  await assert.rejects(hardenElectronFuses(original, 'gui'), /removed/);
  await fs.writeFile(original, fuseBytes()); await assert.rejects(hardenElectronFuses(original, 'caller-defined'), /Unknown/);
}));

test('execution verifier rejects custom privilege paths and linked files before launch', isolated, async () => fixture(async directory => {
  const candidate = path.join(directory, 'own-runtime.exe'); await fs.writeFile(candidate, 'not-executed');
  const lease = await verifyNativeRuntimeForExecution({ runtimePath: candidate, runtimeKind: 'xray', privileged: false });
  assert.equal(lease.runtimePath, candidate); lease.release();
  await assert.rejects(verifyNativeRuntimeForExecution({ runtimePath: candidate, runtimeKind: 'xray', privileged: true, resourcesPath: path.join(directory, 'resources') }), /встроенный runtime/);
  const alias = path.join(directory, 'alias.exe'); await fs.link(candidate, alias);
  await assert.rejects(verifyNativeRuntimeForExecution({ runtimePath: alias, runtimeKind: 'xray' }), /без ссылок/);
  const linked = path.join(directory, 'linked'); await fs.symlink(directory, linked, 'junction');
  try { await assert.rejects(verifyNativeRuntimeForExecution({ runtimePath: path.join(linked, 'own-runtime.exe'), runtimeKind: 'xray' }), /ссылок/); }
  finally { await fs.unlink(linked); }
}));

test('privileged bootstrap rejects user-owned fake verifier before executing it', { skip: isolated.skip || windows.skip }, async () => fixture(async directory => {
  const resources = path.join(directory, 'resources');
  const candidate = path.join(resources, 'runtime/xray/xray.exe');
  const helper = path.join(resources, 'core-service/win-x64/EgoistShield.Service.exe');
  for (const file of [candidate, helper]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'own inert fixture; must never be executed'); }
  await assert.rejects(verifyNativeRuntimeForExecution({ runtimePath: candidate, runtimeKind: 'xray', privileged: true, resourcesPath: resources }), /outside the Windows Program Files root/);
}));

test('worker inventory authenticates actual files and refuses mutated upstream or linked native payload', isolated, async () => fixture(async directory => {
  const bodies = { 'EgoistShield.exe': fuseBytes('000011011'), 'EgoistShield.Worker.exe': fuseBytes('100011011'), 'ffmpeg.dll': Buffer.from('own dll bytes'), 'resources/app.asar': Buffer.from('own asar bytes'), 'resources/component-worker.cjs': Buffer.from('own fixed worker'), 'resources/installer/gui-login-startup.ps1': Buffer.from('own fixed GUI startup helper'), 'resources/core-service/win-x64/EgoistShield.Service.exe': Buffer.from('own fixed Core'), 'resources/runtime/xray/xray.exe': Buffer.from('own fixed xray') };
  for (const [relative, body] of Object.entries(bodies)) { const file = path.join(directory, ...relative.split('/')); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); }
  const digest = value => createHash('sha256').update(value).digest('hex');
  await fs.writeFile(path.join(directory, 'resources/runtime/manifest.json'), JSON.stringify({ schemaVersion: 1, components: [{ name: 'xray', files: [{ path: 'xray/xray.exe', size: bodies['resources/runtime/xray/xray.exe'].length, sha256: digest(bodies['resources/runtime/xray/xray.exe']) }] }] }));
  const runtime = { version: 'test-only', archive: { sha256: 'a'.repeat(64) }, runtimeFiles: ['EgoistShield.exe', 'ffmpeg.dll'].map(relative => ({ path: relative, bytes: bodies[relative].length, sha256: digest(bodies[relative]) })) };
  const inventory = await createWorkerHostInventory({ out: directory, version: '3.8.0', electronRuntime: runtime });
  assert.equal(inventory.files.length, 9); assert.deepEqual(inventory.files.find(value => value.path === 'EgoistShield.exe').roles, ['gui']);
  assert.deepEqual(inventory.files.find(value => value.path === 'EgoistShield.Worker.exe').roles, ['worker']);
  const startup = inventory.files.find(value => value.path === 'resources/installer/gui-login-startup.ps1');
  assert.deepEqual(startup.roles, ['gui']);
  assert.equal(startup.sha256, digest(bodies[startup.path]));
  assert.deepEqual(inventory.files.find(value => value.path.endsWith('EgoistShield.Service.exe')).roles, ['worker', 'cli']);
  await fs.appendFile(path.join(directory, 'ffmpeg.dll'), 'mutated');
  await assert.rejects(createWorkerHostInventory({ out: directory, version: '3.8.0', electronRuntime: runtime }), /changed before its inventory/);
  await fs.writeFile(path.join(directory, 'ffmpeg.dll'), bodies['ffmpeg.dll']);
  const native = path.join(directory, 'resources/runtime/xray/xray.exe'); await fs.link(native, path.join(directory, 'native-hardlink'));
  await assert.rejects(createWorkerHostInventory({ out: directory, version: '3.8.0', electronRuntime: runtime }), /ordinary unlinked/);
}));
