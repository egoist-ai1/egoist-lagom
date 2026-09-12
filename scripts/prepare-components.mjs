import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
export async function prepareComponents(out, version) {
  const runtime = path.resolve(out, 'resources/runtime');
  const candidates = path.resolve('recovery/component-candidates');
  const updates = [
    { name: 'sing-box', version: 'v1.14.0', archive: 'sing-box-1.14.0-windows-amd64', sha256: '3ffb56267da14e287be48bd10cf7e6505260125bad940b75101fbb4d5d58e5d6' },
    { name: 'zapret', version: '1.10.2', archive: 'zapret-discord-youtube-1.10.2', sha256: '5eaac9fb2e4b1abd693487452a3ff3f4dfe9578a45f9ddddfa4bc1f5a6bb62d5' },
  ];
  for (const update of updates) {
    const bytes = await fs.readFile(path.join(candidates, update.archive + '.zip'));
    if (createHash('sha256').update(bytes).digest('hex') !== update.sha256) throw new Error('Candidate checksum mismatch: ' + update.name);
    const source = path.join(candidates, update.archive, update.archive);
    const target = path.join(runtime, update.name);
    if (update.name === 'sing-box') await fs.copyFile(path.join(source,'sing-box.exe'), path.join(target,'sing-box.exe'));
    else {
      const core = path.resolve(target,'core');
      if (!core.startsWith(runtime + path.sep)) throw new Error('Unexpected runtime destination');
      await fs.rm(core, { recursive: true, force: true });
      await fs.cp(source, core, { recursive: true });
    }
    await fs.writeFile(path.join(target,'VERSION.txt'), update.version + '\n');
  }
  const manifestPath = path.join(runtime,'manifest.json');
  const wintunArchive = await fs.readFile(path.join(candidates, 'wintun-0.14.1.zip'));
  if (createHash('sha256').update(wintunArchive).digest('hex') !== '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51') throw new Error('Official Wintun checksum mismatch');
  const wintunSource = path.join(candidates, 'wintun-0.14.1/wintun');
  await fs.copyFile(path.join(wintunSource, 'bin/amd64/wintun.dll'), path.join(runtime, 'xray/wintun.dll'));
  await fs.copyFile(path.join(wintunSource, 'LICENSE.txt'), path.join(runtime, 'xray/WINTUN-LICENSE.txt'));
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.packageVersion = version;
  manifest.generatedAt = new Date().toISOString();
  for (const update of [...updates, {name:'xray',version:manifest.components.find(value => value.name === 'xray').version}]) {
    const component = manifest.components.find(value => value.name === update.name);
    component.version = component.desiredVersion = update.version;
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
}
