import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const scriptRoot = import.meta.dirname;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadComponentPins(descriptor = path.join(scriptRoot, 'component-inputs.json')) {
  const value = JSON.parse(await fs.readFile(descriptor, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.components) || new Set(value.components.map(item => item.name)).size !== value.components.length) throw new Error('Invalid component input descriptor');
  for (const pin of value.components) {
    if (!['sing-box', 'zapret', 'wintun'].includes(pin.name) || typeof pin.version !== 'string' || !pin.version || typeof pin.archive !== 'string' || path.basename(pin.archive) !== pin.archive || !/^[a-z0-9][a-z0-9._-]*\.zip$/i.test(pin.archive) || typeof pin.rootDirectory !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(pin.rootDirectory) || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error('Invalid pinned component: ' + pin.name);
  }
  if (value.components.length !== 3) throw new Error('Component descriptor must cover sing-box, zapret and wintun');
  return value.components;
}

export async function loadBinaryPins(descriptor = path.join(scriptRoot, 'component-inputs.json')) {
  const value = JSON.parse(await fs.readFile(descriptor, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.binaries) || value.binaries.length !== 1) throw new Error('Invalid binary input descriptor');
  for (const pin of value.binaries) {
    if (pin.name !== 'winsw' || pin.version !== '2.12.0' || pin.file !== 'WinSW.NET461.exe' || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(pin.sha256) || pin.runtime !== '.NET Framework' || pin.minimumFrameworkRelease !== 528040) throw new Error('Invalid pinned binary: ' + pin.name);
  }
  return value.binaries;
}

export async function verifyPinnedBinary(pin, candidates) {
  const file = path.join(candidates, pin.file);
  await assertOrdinaryParents(file, candidates);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== pin.bytes || digest(await fs.readFile(file)) !== pin.sha256) throw new Error('Pinned binary input rejected: ' + pin.name);
  return { ...pin, extracted: candidates, files: [{ path: pin.file, bytes: pin.bytes, sha256: pin.sha256 }] };
}

export async function verifyLicenseNotices(directory = path.resolve('resources/licenses')) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'sources.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error('Native license inventory is absent');
  const files = [...manifest.files];
  for (const name of ['sources.json', 'native-components.json', 'source-inputs.json', 'SOURCE-DIRECTIONS.txt', 'sing-box-1.14.0-build-info.txt']) {
    const bytes = await fs.readFile(path.join(directory, name));
    files.push({ file: name, bytes: bytes.length, sha256: digest(bytes) });
  }
  if (new Set(files.map(item => item.file.toLowerCase())).size !== files.length) throw new Error('Duplicate native notice file');
  for (const entry of files) {
    if (typeof entry.file !== 'string' || !/^(?:(?:go-modules|native-upstream)\/)?[a-zA-Z0-9._-]+$/.test(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid native notice entry');
    const file = path.join(directory, ...entry.file.split('/'));
    await assertOrdinaryParents(file, directory);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== entry.bytes || digest(await fs.readFile(file)) !== entry.sha256) throw new Error('Native license notice differs from pinned source: ' + entry.file);
  }
  return { extracted: directory, files: files.map(entry => ({ path: entry.file, bytes: entry.bytes, sha256: entry.sha256 })) };
}

export async function verifyExtractedComponent(pin, candidates, { python = process.env.SHIELD_PYTHON || 'python' } = {}) {
  const extracted = path.join(candidates, pin.archive.slice(0, -4));
  const result = spawnSync(python, [path.join(scriptRoot, 'verify-component-inputs.py'), '--archive', path.join(candidates, pin.archive), '--sha256', pin.sha256, '--extracted', extracted], { windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Component input rejected: ' + pin.name + ': ' + (result.error?.message || result.stderr || result.stdout || '').trim().slice(0, 1500));
  const inventory = JSON.parse(result.stdout);
  if (inventory.schemaVersion !== 1 || inventory.archiveSha256 !== pin.sha256 || !Array.isArray(inventory.files) || !inventory.files.length || inventory.files.some(item => !item.path.startsWith(pin.rootDirectory + '/') || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256))) throw new Error('Invalid authenticated component inventory: ' + pin.name);
  return { ...pin, extracted, files: inventory.files };
}

async function assertOrdinaryParents(file, root) {
  let current = path.dirname(file);
  const bound = path.resolve(root);
  if (!path.resolve(file).startsWith(bound + path.sep)) throw new Error('Component copy escaped its owned root');
  while (true) {
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Linked component copy directory: ' + current);
    if (current === bound) break;
    current = path.dirname(current);
  }
}

export async function copyAuthenticatedComponentFile(input, entry, destination, outputRoot) {
  const source = path.join(input.extracted, ...entry.path.split('/'));
  await assertOrdinaryParents(source, input.extracted);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) throw new Error('Linked component copy input: ' + entry.path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await assertOrdinaryParents(destination, outputRoot);
  const existing = await fs.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw new Error('Linked component copy destination');
  await fs.copyFile(source, destination);
  const stat = await fs.lstat(destination);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== entry.bytes || digest(await fs.readFile(destination)) !== entry.sha256) throw new Error('Component copy changed after authentication: ' + entry.path);
}

export async function prepareComponents(out, version) {
  const runtime = path.resolve(out, 'resources/runtime');
  const candidates = path.resolve('recovery/component-candidates');
  const pins = await loadComponentPins();
  const binaries = await loadBinaryPins();
  const inputs = [];
  // Authenticate every input before replacing any packaged component.
  for (const pin of pins) inputs.push(await verifyExtractedComponent(pin, candidates));
  const wrapper = await verifyPinnedBinary(binaries[0], candidates);
  const notices = await verifyLicenseNotices();
  for (const input of inputs.filter(item => item.name !== 'wintun')) {
    const target = path.join(runtime, input.name);
    if (input.name === 'sing-box') {
      for (const name of ['sing-box.exe', 'LICENSE']) {
        const entry = input.files.find(item => item.path === `${input.rootDirectory}/${name}`);
        if (!entry) throw new Error('Pinned sing-box archive is missing ' + name);
        await copyAuthenticatedComponentFile(input, entry, path.join(target, name), runtime);
      }
    }
    else {
      const core = path.resolve(target,'core');
      await assertOrdinaryParents(core, runtime);
      const existing = await fs.lstat(core).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Linked component output directory');
      await fs.rm(core, { recursive: true, force: true });
      await fs.mkdir(core, { recursive: true });
      for (const entry of input.files) {
        const relative = entry.path.slice(input.rootDirectory.length + 1);
        await copyAuthenticatedComponentFile(input, entry, path.join(core, ...relative.split('/')), runtime);
      }
      await fs.copyFile('src/zapret/general (EGOIST MIX).bat', path.join(core, 'general (EGOIST MIX).bat'));
      await fs.copyFile('src/zapret/list-egoist-discord.txt', path.join(core, 'lists/list-egoist-discord.txt'));
      await fs.copyFile('src/zapret/list-egoist-sites.txt', path.join(core, 'lists/list-egoist-sites.txt'));
    }
    await fs.writeFile(path.join(target,'VERSION.txt'), input.version + '\n');
  }
  await copyAuthenticatedComponentFile(wrapper, wrapper.files[0], path.join(runtime, 'zapret/service-wrapper/egoistshield-zapret-service.exe'), runtime);
  await fs.copyFile('resources/runtime/zapret/service-wrapper/egoistshield-zapret-service.xml', path.join(runtime, 'zapret/service-wrapper/egoistshield-zapret-service.xml'));
  const manifestPath = path.join(runtime,'manifest.json');
  const wintun = inputs.find(item => item.name === 'wintun');
  for (const [relative, target] of [['bin/amd64/wintun.dll', 'xray/wintun.dll'], ['LICENSE.txt', 'xray/WINTUN-LICENSE.txt']]) {
    const entry = wintun.files.find(item => item.path === `${wintun.rootDirectory}/${relative}`);
    if (!entry) throw new Error('Pinned Wintun archive is missing ' + relative);
    await copyAuthenticatedComponentFile(wintun, entry, path.join(runtime, ...target.split('/')), runtime);
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.packageVersion = version;
  manifest.generatedAt = new Date().toISOString();
  const updates = [...inputs.filter(item => item.name !== 'wintun'), {name:'xray',version:manifest.components.find(value => value.name === 'xray').version}];
  for (const update of updates) {
    const component = manifest.components.find(value => value.name === update.name);
    if (!component) throw new Error('Runtime manifest is missing component ' + update.name);
    component.version = component.desiredVersion = update.version;
    if (update.name === 'zapret') component.serviceWrapper = { name: wrapper.name, version: wrapper.version, variant: wrapper.file, runtime: wrapper.runtime, minimumFrameworkRelease: wrapper.minimumFrameworkRelease, sha256: wrapper.sha256, bytes: wrapper.bytes, sourceUrl: wrapper.url };
    component.files = [];
    const directory = path.join(runtime, update.name);
    for (const file of await fs.readdir(directory, { recursive: true, withFileTypes: true })) if (file.isFile()) {
      const absolute = path.join(file.parentPath, file.name);
      const bytes = await fs.readFile(absolute);
      component.files.push({ path: path.relative(runtime,absolute).replaceAll('\\','/'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    component.fileCount = component.files.length;
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest,null,2) + '\n');
  const resourcesRoot = path.resolve(out, 'resources');
  for (const entry of notices.files) await copyAuthenticatedComponentFile(notices, entry, path.join(resourcesRoot, 'licenses', ...entry.path.split('/')), resourcesRoot);
}
