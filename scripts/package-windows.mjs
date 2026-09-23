import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createPackage, listPackage } from '@electron/asar';
import { rcedit } from 'rcedit';
import { prepareComponents } from './prepare-components.mjs';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const retryWindowsFileOperation = async operation => {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EACCES', 'EPERM'].includes(error?.code) || attempt === 11) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw lastError;
};
const evidence = process.env.SHIELD_EVIDENCE_DIR;
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Set SHIELD_EVIDENCE_DIR to an absolute task-scoped directory.');
await fs.mkdir(evidence, { recursive: true });
const out = path.join(root, 'out', `EgoistShield-${pkg.version}-win-x64`);
const appRoot = path.join(root, 'out', `app-${pkg.version}`);
await fs.mkdir('dist', { recursive: true });
const recoveredApp = path.resolve('recovery/official-app');
const retiredScripts = 'resources/scripts/system-control';
await fs.rm(out, { recursive: true, force: true });
await fs.rm(appRoot, { recursive: true, force: true });
await fs.cp(recoveredApp, out, {
  recursive: true,
  filter: source => {
    const relative = path.relative(recoveredApp, source).split(path.sep).join('/');
    return relative !== retiredScripts && !relative.startsWith(retiredScripts + '/');
  },
});
const obsoleteScripts = path.resolve(out, retiredScripts);
if (!obsoleteScripts.startsWith(out + path.sep)) throw new Error('Unexpected retired-script destination');
await fs.rm(obsoleteScripts, { recursive: true, force: true });
await prepareComponents(out, pkg.version);
await fs.cp('resources/release', path.join(out,'resources/release'), { recursive: true });
await rcedit(path.join(out, 'EgoistShield.exe'), { 'file-version': pkg.version, 'product-version': pkg.version, 'version-string': { ProductName: 'Egoist Lagom', FileDescription: 'Egoist Lagom', ProductVersion: pkg.version, FileVersion: pkg.version }, icon: path.join(out, 'resources/brand/icon.ico') });
await fs.mkdir(appRoot, { recursive: true });
await fs.cp('.vite', path.join(appRoot, '.vite'), { recursive: true });
await fs.cp('node_modules/electron-log', path.join(appRoot, 'node_modules/electron-log'), { recursive: true });
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, type: 'module', main: pkg.main, license: pkg.license }, null, 2));
await createPackage(appRoot, path.join(out, 'resources/app.asar'));
await fs.copyFile('.vite/build/component-worker.cjs', path.join(out, 'resources/component-worker.cjs'));
const cleanupScript=await fs.readFile('src/installer/owned-cleanup.ps1');
if(!cleanupScript.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))throw new Error('Installer PowerShell script requires its UTF-8 BOM for Windows PowerShell 5.1.');
await fs.writeFile(path.join(out, 'resources/installer/owned-cleanup.ps1'),cleanupScript);
const reinstallScript = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1');
const reinstallScriptWithBom = reinstallScript.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  ? reinstallScript
  : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), reinstallScript]);
await fs.writeFile(path.join(out, 'resources/installer/invoke-final-silent-reinstall.ps1'), reinstallScriptWithBom);
await fs.copyFile('scratch/Unbounded.ttf', path.join(out, 'resources/installer/Unbounded.ttf'));
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const wpfLib = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\WPF';
const modernInstallerOut = path.join(out, 'resources/installer/ModernInstaller.exe');
const modernInstallerCs = path.resolve('src/installer/ModernInstaller.cs');
const modernInstallerManifest = path.resolve('src/installer/ModernInstaller.manifest');
const brandIcon = path.join(out, 'resources/brand/icon.ico');
console.log('Compiling ModernInstaller.exe...');
const cscResult = spawnSync(csc, [
  '/nologo',
  '/t:winexe',
  `/win32icon:${brandIcon}`,
  `/win32manifest:${modernInstallerManifest}`,
  `/lib:${wpfLib}`,
  '/r:PresentationFramework.dll',
  '/r:PresentationCore.dll',
  '/r:WindowsBase.dll',
  '/r:System.dll',
  '/r:System.Xaml.dll',
  '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll',
  `/out:${modernInstallerOut}`,
  modernInstallerCs
], { encoding: 'utf8' });
if (cscResult.status !== 0) throw new Error('Failed to compile ModernInstaller.exe:\n' + (cscResult.stderr || '') + (cscResult.stdout || ''));
console.log('Publishing Core service...');
const dotnet = process.env.SHIELD_DOTNET || path.join(root, '.tools/dotnet/dotnet.exe');
const publish = spawnSync(dotnet, ['publish', 'src/service/EgoistShield.Service.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-p:EnableCompressionInSingleFile=true', '-o', path.join(out, 'resources/core-service/win-x64'), '-v', 'quiet'], { windowsHide: true, env: { ...process.env, DOTNET_ROOT: path.dirname(dotnet), DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' }, encoding: 'utf8' });
await fs.writeFile(path.join(evidence, 'core-publish.txt'), [publish.stdout ?? '', publish.stderr ?? '', publish.error?.message ?? ''].join(''));
if (publish.status !== 0) throw new Error('Core publish failed; see ' + path.join(evidence, 'core-publish.txt'));
console.log('Configuring NSIS...');
const makensis = process.env.SHIELD_MAKENSIS || path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n/Bin/makensis.exe');
const setupFinal=path.join(root,'dist',`EgoistShield-Setup-${pkg.version}.exe`);
const setupCandidate=path.join(root,'dist',`EgoistShield-Setup-${pkg.version}.building`);
await fs.rm(path.join(root, 'dist', 'EgoistShield-Setup-Lagom.exe'), { force: true });
await retryWindowsFileOperation(() => fs.rm(setupCandidate, { force: true }));
console.log('Running makensis compression...');
const setupSource = await fs.readFile('src/installer/setup.nsi', 'utf8');
const setupSourceWithBom = '\uFEFF' + setupSource.replace(/^\uFEFF/, '');
const generatedSetup = path.join(evidence, 'setup.utf8.nsi');
await fs.writeFile(generatedSetup, setupSourceWithBom, 'utf8');
const installerCode = await new Promise((resolve, reject) => {
  const child = spawn(makensis, ['/V2', '/INPUTCHARSET', 'UTF8', `/DPRODUCT_VERSION=${pkg.version}`, `/DPAYLOAD=${out}`, `/DOUTPUT=${setupCandidate}`, generatedSetup], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', resolve);
});
console.log('NSIS finished with exit code:', installerCode);
await fs.writeFile(path.join(evidence, 'nsis-build.txt'), `status=${installerCode}\n`);
if (installerCode !== 0) throw new Error('NSIS failed with exit code ' + installerCode);
const setupPrevious = setupFinal + '.previous';
await fs.rm(setupPrevious, { force: true });
let previousMoved = false;
try {
  await retryWindowsFileOperation(async () => {
    await fs.rename(setupFinal, setupPrevious);
    previousMoved = true;
  });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
try {
  await retryWindowsFileOperation(() => fs.rename(setupCandidate, setupFinal));
} catch (error) {
  const [candidate, final] = await Promise.all([
    fs.stat(setupCandidate).catch(() => null),
    fs.stat(setupFinal).catch(() => null),
  ]);
  if (!candidate && final) {
    if (previousMoved) await fs.rm(setupPrevious, { force: true });
    console.log(setupFinal);
    process.exit(0);
  }
  if (previousMoved) await retryWindowsFileOperation(() => fs.rename(setupPrevious, setupFinal));
  throw error;
}
if (previousMoved) await fs.rm(setupPrevious, { force: true });
const sha256 = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex').toUpperCase();
const installerStat = await fs.stat(setupFinal);
const installerSha256 = await sha256(setupFinal);
const publicSetup = path.join(root, 'dist', 'Egoist-Lagom-Setup.exe');
await retryWindowsFileOperation(() => fs.rm(publicSetup, { force: true }));
await retryWindowsFileOperation(() => fs.copyFile(setupFinal, publicSetup));
const publicSetupSha256 = await sha256(publicSetup);
const asarPath = path.join(out, 'resources/app.asar');
const asarEntries = (await listPackage(asarPath)).map(entry => entry.replaceAll('\\', '/').replace(/^\//, ''));
const requiredAsarEntries = [
  '.vite/build/main.js',
  '.vite/build/preload.js',
  '.vite/build/component-worker.cjs',
  '.vite/renderer/main_window/index.html',
  '.vite/renderer/main_window/assets/brand.css',
  '.vite/renderer/main_window/assets/shield-motion.js'
];
const missingAsarEntries = requiredAsarEntries.filter(entry => !asarEntries.includes(entry));
if (missingAsarEntries.length) throw new Error(`ASAR is missing required entries: ${missingAsarEntries.join(', ')}`);
const requiredPayloadFiles = [
  'EgoistShield.exe',
  'resources/app.asar',
  'resources/component-worker.cjs',
  'resources/core-service/win-x64/EgoistShield.Service.exe',
  'resources/runtime/manifest.json',
  'resources/gravityless-dns/dnscrypt-proxy.exe',
  'resources/gravityless-dns/dnscrypt-proxy.toml',
  'resources/installer/owned-cleanup.ps1',
  'resources/installer/invoke-final-silent-reinstall.ps1',
  'resources/installer/ModernInstaller.exe'
];
const payload = [];
for (const relative of requiredPayloadFiles) {
  const file = path.join(out, ...relative.split('/'));
  const stat = await fs.stat(file);
  payload.push({ path: relative, bytes: stat.size, sha256: await sha256(file) });
}
const integrity = {
  generatedAt: new Date().toISOString(),
  product: pkg.productName,
  version: pkg.version,
  installer: { path: path.relative(root, setupFinal).split(path.sep).join('/'), bytes: installerStat.size, sha256: installerSha256 },
  publicInstaller: { path: path.relative(root, publicSetup).split(path.sep).join('/'), bytes: installerStat.size, sha256: publicSetupSha256 },
  asar: { path: path.relative(root, asarPath).split(path.sep).join('/'), entries: asarEntries.length, required: requiredAsarEntries },
  payload
};
await fs.writeFile(path.join(root, 'dist', `EgoistShield-Setup-${pkg.version}.exe.sha256`), `${installerSha256}  EgoistShield-Setup-${pkg.version}.exe\n`);
await fs.writeFile(path.join(root, 'dist', 'Egoist-Lagom-Setup.exe.sha256'), `${publicSetupSha256}  Egoist-Lagom-Setup.exe\n`);
await fs.writeFile(path.join(root, 'dist', 'package-integrity.json'), JSON.stringify(integrity, null, 2) + '\n');
await fs.rm(path.join(root, 'dist', 'release-receipt.json'), { force: true });
console.log(path.join(root, 'dist', `EgoistShield-Setup-${pkg.version}.exe`));
