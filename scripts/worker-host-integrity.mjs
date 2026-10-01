import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function createWorkerHostInventory({ out, version, electronRuntime }) {
  const items = new Map();
  const add = (relative, roles, pin) => {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(value => !value || value === '..' || value === '.'))
      throw new Error('Invalid worker host inventory path.');
    if (items.has(relative.toLowerCase())) throw new Error('Duplicate worker host inventory path.');
    items.set(relative.toLowerCase(), { path: relative, roles, pin });
  };
  for (const file of electronRuntime.runtimeFiles)
    add(file.path, file.path === 'EgoistShield.exe' || file.path.startsWith('locales/') ? ['gui'] : ['gui', 'worker'], file);
  add('EgoistShield.Worker.exe', ['worker']);
  add('resources/app.asar', ['gui']);
  add('resources/component-worker.cjs', ['worker']);
  add('resources/core-service/win-x64/EgoistShield.Service.exe', ['worker', 'cli']);
  for (const name of await fs.readdir(path.join(out, 'resources/core-service/win-x64')))
    if (name.toLowerCase().endsWith('.dll')) add('resources/core-service/win-x64/' + name, ['worker', 'cli']);
  add('resources/runtime/manifest.json', ['worker', 'cli']);
  const nativeManifest = JSON.parse(await fs.readFile(path.join(out, 'resources/runtime/manifest.json'), 'utf8'));
  for (const component of nativeManifest.components) {
    if (component.name === 'electron') continue;
    for (const file of component.files ?? [])
      add('resources/runtime/' + file.path, ['worker'], { bytes: file.size, sha256: file.sha256 });
  }
  const files = [];
  for (const entry of [...items.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    const file = path.join(out, ...entry.path.split('/'));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Worker host inventory requires ordinary unlinked files: ' + entry.path);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    if (entry.pin && (entry.pin.bytes !== stat.size || entry.pin.sha256.toLowerCase() !== sha256)) throw new Error('Worker/native payload changed before its inventory: ' + entry.path);
    files.push({ path: entry.path, bytes: stat.size, sha256, roles: entry.roles });
  }
  const inventory = {
    schemaVersion: 1, owner: 'EgoistShield', packageVersion: version,
    trust: 'Authenticated installer payload; administrator/System-owned non-writable installation; held file handles before execution.',
    electronVersion: electronRuntime.version, electronArchiveSha256: electronRuntime.archive.sha256,
    guiFuseWire: '000011011', workerFuseWire: '100011011', files
  };
  await fs.writeFile(path.join(out, 'resources/worker-host-integrity.json'), JSON.stringify(inventory, null, 2) + '\n');
  return inventory;
}
