import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createPackage, listPackage } from '@electron/asar';
import { rcedit } from 'rcedit';
import { prepareComponents } from './prepare-components.mjs';
import { verifyPinnedElectronRuntime, stageElectronPayload, addElectronToRuntimeManifest, verifyPackagedInstallHealth } from './electron-runtime.mjs';
import { packageSource, assertPackageSource } from './package-source.mjs';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Packaging requires a stable numeric version.');
const buildSource = await packageSource(root);
const patchedDotnet = path.join(root, '.tools/dotnet-10.0.401/dotnet.exe');
const dotnet = process.env.SHIELD_DOTNET || (await fs.access(patchedDotnet).then(() => patchedDotnet).catch(() => path.join(root, '.tools/dotnet/dotnet.exe')));
const sdkCheck = spawnSync(dotnet, ['--version'], { windowsHide: true, encoding: 'utf8' });
if (sdkCheck.status !== 0) throw new Error('Required .NET SDK is unavailable; install the version selected by global.json or set SHIELD_DOTNET.');
const requiredSdk = JSON.parse(await fs.readFile('global.json', 'utf8')).sdk.version;
if (sdkCheck.stdout.trim() !== requiredSdk) throw new Error(`Packaging requires the pinned .NET SDK ${requiredSdk}; received ${sdkCheck.stdout.trim()}.`);
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
await fs.writeFile(path.join(evidence, 'package-source.json'), JSON.stringify(buildSource, null, 2) + '\n');
const rendererBuild = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { windowsHide: true, encoding: 'utf8' });
await fs.writeFile(path.join(evidence, 'desktop-build.txt'), [rendererBuild.stdout ?? '', rendererBuild.stderr ?? '', rendererBuild.error?.message ?? ''].join(''));
if (rendererBuild.status !== 0) throw new Error('Desktop build failed; see ' + path.join(evidence, 'desktop-build.txt'));
const out = path.join(root, 'out', `EgoistShield-${pkg.version}-win-x64`);
const appRoot = path.join(root, 'out', `app-${pkg.version}`);
const assertOwnedOutputDirectory = async target => {
  const outputRoot = path.resolve(root, 'out');
  if (path.dirname(path.resolve(target)) !== outputRoot) throw new Error('Unexpected package output directory.');
  for (const directory of [root, outputRoot, target]) {
    const stat = await fs.lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Package output must use ordinary directories: ' + directory);
  }
};
await assertOwnedOutputDirectory(out);
await assertOwnedOutputDirectory(appRoot);
await fs.mkdir('dist', { recursive: true });
const nativeSourceFile = path.join(root, 'dist', `Egoist-Lagom-${pkg.version}-native-sources.zip`);
const sourcePython = process.env.EGOIST_RELEASE_PYTHON || process.env.SHIELD_PYTHON || 'python';
const nativeSourceBuild = spawnSync(sourcePython, [
  path.join(root, 'scripts/prepare-native-sources.py'), '--work-dir', evidence, '--output', nativeSourceFile,
  ...(process.env.SHIELD_NATIVE_SOURCES_OFFLINE === '1' ? ['--offline'] : [])
], { windowsHide: true, encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 });
await fs.writeFile(path.join(evidence, 'native-source-build.txt'), [nativeSourceBuild.stdout ?? '', nativeSourceBuild.stderr ?? '', nativeSourceBuild.error?.message ?? ''].join(''));
if (nativeSourceBuild.status !== 0) throw new Error('Pinned native source companion failed; see ' + path.join(evidence, 'native-source-build.txt'));
const nativeSourceResult = JSON.parse(nativeSourceBuild.stdout);
const nativeSourceStat = await fs.lstat(nativeSourceFile);
if (nativeSourceResult.path !== nativeSourceFile || !nativeSourceStat.isFile() || nativeSourceStat.isSymbolicLink() || nativeSourceResult.bytes !== nativeSourceStat.size || !/^[a-f0-9]{64}$/.test(nativeSourceResult.sha256)) throw new Error('Invalid native source companion receipt.');
const nativeSources = { path: path.relative(root, nativeSourceFile).split(path.sep).join('/'), bytes: nativeSourceStat.size, sha256: nativeSourceResult.sha256.toUpperCase(), sourceArchives: nativeSourceResult.sourceArchives, coverage: nativeSourceResult.coverage };
const recoveredApp = path.resolve('recovery/official-app');
const electronRuntime = await verifyPinnedElectronRuntime(root);
await fs.writeFile(path.join(evidence, 'electron-runtime-input.json'), JSON.stringify(electronRuntime, null, 2) + '\n');
await fs.rm(out, { recursive: true, force: true });
await fs.rm(appRoot, { recursive: true, force: true });
const stagedElectron = await stageElectronPayload({ runtime: electronRuntime, out, recoveredResources: path.join(recoveredApp, 'resources') });
await prepareComponents(out, pkg.version);
await fs.cp('resources/release', path.join(out,'resources/release'), { recursive: true });
await rcedit(path.join(out, 'EgoistShield.exe'), { 'file-version': pkg.version, 'product-version': pkg.version, 'requested-execution-level': 'requireAdministrator', 'version-string': { ProductName: 'Egoist Lagom', FileDescription: 'Egoist Lagom', ProductVersion: pkg.version, FileVersion: pkg.version }, icon: path.join(out, 'resources/brand/icon.ico') });
const packagedElectron = await addElectronToRuntimeManifest(out, stagedElectron);
await fs.writeFile(path.join(evidence, 'electron-runtime-packaged.json'), JSON.stringify(packagedElectron, null, 2) + '\n');
await fs.mkdir(appRoot, { recursive: true });
await fs.cp('.vite', path.join(appRoot, '.vite'), { recursive: true });
await fs.cp('node_modules/electron-log', path.join(appRoot, 'node_modules/electron-log'), { recursive: true });
await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, type: 'module', main: pkg.main, license: pkg.license }, null, 2));
await createPackage(appRoot, path.join(out, 'resources/app.asar'));
await fs.copyFile('.vite/build/component-worker.cjs', path.join(out, 'resources/component-worker.cjs'));
const cleanupScript=await fs.readFile('src/installer/owned-cleanup.ps1');
if(!cleanupScript.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))throw new Error('Installer PowerShell script requires its UTF-8 BOM for Windows PowerShell 5.1.');
await fs.writeFile(path.join(out, 'resources/installer/owned-cleanup.ps1'),cleanupScript);
const serviceMaintenanceScript = await fs.readFile('src/installer/service-maintenance.ps1');
await fs.writeFile(path.join(out, 'resources/installer/service-maintenance.ps1'),
  serviceMaintenanceScript.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? serviceMaintenanceScript
    : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), serviceMaintenanceScript]));
const reinstallScript = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1');
const bootRecoveryScript = await fs.readFile('src/installer/maintenance-boot-recovery.ps1');
await fs.writeFile(path.join(out, 'resources/installer/maintenance-boot-recovery.ps1'),
  bootRecoveryScript.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? bootRecoveryScript
    : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bootRecoveryScript]));
const reinstallScriptWithBom = reinstallScript.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  ? reinstallScript
  : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), reinstallScript]);
await fs.writeFile(path.join(out, 'resources/installer/invoke-final-silent-reinstall.ps1'), reinstallScriptWithBom);
await fs.copyFile('resources/installer/Unbounded.ttf', path.join(out, 'resources/installer/Unbounded.ttf'));
await fs.copyFile('resources/installer/Unbounded-OFL.txt', path.join(out, 'resources/installer/Unbounded-OFL.txt'));
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
const dotnetEnvironment = { ...process.env, DOTNET_ROOT: path.dirname(dotnet), DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
const coreIntermediate = path.join(evidence, 'core-obj') + path.sep;
const coreBuildProperties = ['-p:PublishSingleFile=true', '-p:SelfContained=true', `-p:BaseIntermediateOutputPath=${coreIntermediate}`, `-p:MSBuildProjectExtensionsPath=${coreIntermediate}`, '-p:DefaultItemExcludes=obj\\**\\*.cs'];
const restore = spawnSync(dotnet, ['restore', 'src/service/EgoistShield.Service.csproj', '--locked-mode', '-r', 'win-x64', ...coreBuildProperties, '-v', 'quiet'], { windowsHide: true, env: dotnetEnvironment, encoding: 'utf8' });
await fs.writeFile(path.join(evidence, 'core-locked-restore.txt'), [restore.stdout ?? '', restore.stderr ?? '', restore.error?.message ?? ''].join(''));
if (restore.status !== 0) throw new Error('Core locked restore failed; see ' + path.join(evidence, 'core-locked-restore.txt'));
const publish = spawnSync(dotnet, ['publish', 'src/service/EgoistShield.Service.csproj', '--no-restore', '-c', 'Release', '-r', 'win-x64', ...coreBuildProperties, '-p:EnableCompressionInSingleFile=true', '-o', path.join(out, 'resources/core-service/win-x64'), '-v', 'quiet'], { windowsHide: true, env: dotnetEnvironment, encoding: 'utf8' });
await fs.writeFile(path.join(evidence, 'core-publish.txt'), [publish.stdout ?? '', publish.stderr ?? '', publish.error?.message ?? ''].join(''));
if (publish.status !== 0) throw new Error('Core publish failed; see ' + path.join(evidence, 'core-publish.txt'));
const installHealth = await verifyPackagedInstallHealth(out);
await fs.writeFile(path.join(evidence, 'install-health-preflight.json'), JSON.stringify(installHealth, null, 2) + '\n');
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
await assertPackageSource(root, buildSource);
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
if (await sha256(nativeSourceFile) !== nativeSources.sha256 || (await fs.stat(nativeSourceFile)).size !== nativeSources.bytes) throw new Error('Native source companion changed during packaging.');
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
const requiredPayloadFiles = [...new Set([
  ...packagedElectron.runtimeFiles.map(entry => entry.path),
  'resources/runtime/electron/provenance.json',
  'EgoistShield.exe',
  'resources/app.asar',
  'resources/component-worker.cjs',
  'resources/core-service/win-x64/EgoistShield.Service.exe',
  'resources/runtime/manifest.json',
  'resources/release/root-public-key.pem',
  'resources/release/release-key-registry.json',
  'resources/release/release-key-registry.json.sig',
  'resources/gravityless-dns/dnscrypt-proxy.exe',
  'resources/gravityless-dns/dnscrypt-proxy.toml',
  'resources/installer/owned-cleanup.ps1',
  'resources/installer/service-maintenance.ps1',
  'resources/installer/maintenance-boot-recovery.ps1',
  'resources/installer/invoke-final-silent-reinstall.ps1',
  'resources/installer/ModernInstaller.exe'
])];
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
  source: buildSource.source,
  sourceFilesSha256: buildSource.sha256,
  nativeSources,
  electronRuntime: packagedElectron,
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
