import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const productResourceNames = ['brand', 'gravityless-dns', 'installer', 'release', 'runtime', 'scripts', 'elevate.exe'];
const retiredScripts = 'scripts/system-control';
const templateAsar = 'resources/default_app.asar';

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertOrdinaryTree(root, base = root) {
  const files = [];
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Electron/product resources require an ordinary directory: ' + root);
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const value = await fs.lstat(file);
    if (value.isSymbolicLink() || (!value.isDirectory() && (!value.isFile() || value.nlink !== 1))) throw new Error('Linked or unsupported runtime/product input: ' + file);
    if (value.isDirectory()) files.push(...await assertOrdinaryTree(file, base));
    else files.push(path.relative(base, file).split(path.sep).join('/'));
  }
  return files;
}

export async function verifyPinnedElectronRuntime(root, { python = process.env.SHIELD_PYTHON || 'python', descriptor = path.join(root, 'scripts/electron-runtime.json') } = {}) {
  const result = spawnSync(python, [path.join(root, 'scripts/fetch-electron-runtime.py'), '--project-root', root, '--descriptor', descriptor, '--verify'], { windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Pinned Electron runtime is unavailable or rejected. Run scripts/fetch-electron-runtime.py with --work-dir first. ' + (result.error?.message || result.stderr || '').slice(0, 1500));
  const runtime = JSON.parse(result.stdout);
  const pin = JSON.parse(await fs.readFile(descriptor, 'utf8'));
  const expected = path.join(root, '.tools', `electron-${pin.version}`, 'runtime');
  if (runtime.schemaVersion !== 1 || runtime.version !== pin.version || runtime.platform !== 'win32' || runtime.arch !== 'x64' || runtime.archive?.sha256 !== pin.asset?.sha256 || path.resolve(runtime.runtimePath) !== path.resolve(expected) || !Array.isArray(runtime.files) || !runtime.files.length) throw new Error('Pinned Electron verification returned an inconsistent runtime');
  return runtime;
}

export function packagedRuntimeFiles(runtime) {
  return runtime.files.filter(entry => entry.path !== templateAsar).map(entry => ({ ...entry, path: entry.path === 'electron.exe' ? 'EgoistShield.exe' : entry.path }));
}

export async function stageElectronPayload({ runtime, out, recoveredResources }) {
  const observedRuntimeFiles = await assertOrdinaryTree(runtime.runtimePath);
  if (JSON.stringify(observedRuntimeFiles.sort()) !== JSON.stringify(runtime.files.map(entry => entry.path).sort())) throw new Error('Verified Electron runtime file set changed before staging');
  await assertOrdinaryTree(recoveredResources);
  const outStat = await fs.lstat(out).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (outStat) throw new Error('Electron payload staging requires a new output directory');
  await fs.cp(runtime.runtimePath, out, { recursive: true, filter: source => path.relative(runtime.runtimePath, source).split(path.sep).join('/') !== templateAsar });
  await fs.rename(path.join(out, 'electron.exe'), path.join(out, 'EgoistShield.exe'));
  const runtimeFiles = packagedRuntimeFiles(runtime);
  if (JSON.stringify((await assertOrdinaryTree(out)).sort()) !== JSON.stringify(runtimeFiles.map(entry => entry.path).sort())) throw new Error('Copied Electron runtime file set mismatch');
  for (const entry of runtimeFiles) {
    const file = path.join(out, ...entry.path.split('/'));
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== entry.bytes || await sha256File(file) !== entry.sha256) throw new Error('Copied Electron runtime checksum mismatch: ' + entry.path);
  }
  const resources = path.join(out, 'resources');
  await fs.mkdir(resources, { recursive: true });
  for (const name of productResourceNames) {
    const source = path.join(recoveredResources, name);
    if (!await fs.lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) continue;
    await fs.cp(source, path.join(resources, name), {
      recursive: true,
      filter: file => {
        const relative = path.relative(recoveredResources, file).split(path.sep).join('/');
        return relative !== retiredScripts && !relative.startsWith(retiredScripts + '/');
      }
    });
  }
  const { runtimePath, files, ...pin } = runtime;
  const provenance = {
    ...pin,
    executable: { packagedName: 'EgoistShield.exe', upstreamSha256: files.find(entry => entry.path === 'electron.exe')?.sha256, modifiedFor: ['product icon/version', 'requireAdministrator manifest'] },
    productResourceNames,
    excludedRecoveredResources: ['app.asar', 'core-service'],
    excludedUpstreamSample: templateAsar,
    runtimeFiles
  };
  const relative = 'resources/runtime/electron/provenance.json';
  await fs.mkdir(path.dirname(path.join(out, ...relative.split('/'))), { recursive: true });
  await fs.writeFile(path.join(out, ...relative.split('/')), JSON.stringify(provenance, null, 2) + '\n');
  return { provenance, provenancePath: relative, runtimeFiles };
}

export async function addElectronToRuntimeManifest(out, staged) {
  const files = [];
  for (const upstream of staged.runtimeFiles) {
    const file = path.join(out, ...upstream.path.split('/'));
    const stat = await fs.lstat(file);
    const sha256 = await sha256File(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (upstream.path !== 'EgoistShield.exe' && (stat.size !== upstream.bytes || sha256 !== upstream.sha256))) throw new Error('Electron runtime changed while packaging: ' + upstream.path);
    files.push({ path: upstream.path, bytes: stat.size, sha256, ...(sha256 !== upstream.sha256 ? { upstreamSha256: upstream.sha256 } : {}) });
  }
  const provenance = { ...staged.provenance, runtimeFiles: files };
  const provenanceFile = path.join(out, ...staged.provenancePath.split('/'));
  await fs.writeFile(provenanceFile, JSON.stringify(provenance, null, 2) + '\n');
  const manifestFile = path.join(out, 'resources/runtime/manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components)) throw new Error('Invalid product runtime manifest for Electron provenance');
  manifest.components = manifest.components.filter(entry => entry.name.toLowerCase() !== 'electron');
  manifest.components.push({
    name: 'electron', displayName: 'Electron', present: true, ownership: 'packaged-desktop-runtime', installScope: 'self-contained-installer',
    version: provenance.version, desiredVersion: provenance.version,
    upstream: { project: 'electron/electron', repositoryUrl: 'https://github.com/electron/electron', releasePageUrl: provenance.releaseUrl },
    updateTrust: 'pinned-official-sha256', checksumRequired: true, autoApplyAllowed: false,
    archive: provenance.archive, provenancePath: staged.provenancePath, fileCount: 1,
    files: [
      { path: 'electron/provenance.json', size: (await fs.stat(provenanceFile)).size, sha256: await sha256File(provenanceFile) }
    ],
    inventoryScope: 'Electron version, original archive and complete packaged runtime hashes are recorded in electron/provenance.json. Health checks verify only the provenance hash; the root version marker and all runtime files remain in package-integrity.json.'
  });
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { ...provenance, provenancePath: staged.provenancePath };
}

export async function verifyPackagedInstallHealth(out, { projectRoot = path.resolve(import.meta.dirname, '..'), powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') } = {}) {
  const source = path.join(projectRoot, 'src/installer/owned-cleanup.ps1');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(projectRoot, 'scripts/check-packaged-install-health.ps1'), '-Source', source, '-CandidateRoot', out], { windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Packaged installer health preflight failed: ' + (result.error?.message || result.stderr || result.stdout || '').slice(0, 2000));
  const receipt = JSON.parse(result.stdout);
  if (receipt.schemaVersion !== 1 || receipt.healthy !== true || typeof receipt.root !== 'string' || path.resolve(receipt.root).toLowerCase() !== path.resolve(out).toLowerCase() || receipt.sourceSha256 !== await sha256File(source)) throw new Error('Packaged installer health preflight returned an inconsistent result');
  return receipt;
}
