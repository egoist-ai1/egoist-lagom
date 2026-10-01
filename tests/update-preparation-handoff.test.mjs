import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import test from 'node:test';
import { loadRecovered } from './load-recovered.mjs';

const sourcePath = path.resolve('scripts/invoke-final-silent-reinstall.ps1');
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

async function runPreparation(t, exitCode) {
  const root = await fs.mkdtemp(path.join(process.env.SHIELD_TEST_WORK_ROOT ?? os.tmpdir(), 'lagom-prep-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const childPath = path.join(root, 'inert-preparation.ps1');
  await fs.writeFile(childPath, `Start-Sleep -Milliseconds 100\n[IO.File]::WriteAllText($env:LAGOM_PREP_DONE, 'actual-own-child-ready')\nexit ${exitCode}\n`);
  const wrapperPath = path.join(root, 'extracted-dispatch.ps1');
  await fs.writeFile(wrapperPath, String.raw`
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:LAGOM_PREP_SOURCE,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Source parse failed'}
foreach($name in @('ConvertTo-InstallerWindowsArgument','Wait-InstallerElevatedPreparation')){
  $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if($definition){Invoke-Expression $definition.Extent.Text}
}
$branch=$ast.Find({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if (-not (Test-IsAdministrator)) {') -and $node.Extent.Text.Contains('$dispatchArguments =')},$true)
if(-not $branch){throw 'Ordinary dispatch branch missing'}
function Test-IsAdministrator { return $false }
function Get-NativePowerShellPath { return $env:LAGOM_PREP_PS }
function Start-Process {
  param($FilePath,$ArgumentList,$Verb,$WindowStyle,$ErrorAction,[switch]$PassThru)
  $start=[Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$env:LAGOM_PREP_PS
  $start.Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$env:LAGOM_PREP_CHILD+'"'
  $start.UseShellExecute=$false
  $start.CreateNoWindow=$true
  $held=[Diagnostics.Process]::new(); $held.StartInfo=$start
  if(-not $held.Start()){throw 'Inert preparation did not start'}
  return $held
}
$release=@{installer='C:\inert\future.exe';version='3.8.1'}
$ExpectedVersion='3.8.1';$DelaySeconds=8;$WatchdogTimeoutSeconds=1200
$EmbeddedRelease=$false;$IntegrityManifestPath='C:\inert\integrity.json';$ExpectedSha256=('a'*64)
$FromVersion='3.8.0';$InstallerUiDirectory='';$InstallerUiPath='';$InstallerFontPath='';$HandoffSignalPath='';$RunAfterPath=''
$NoRunAfter=$false;$MinimizedAfter=$false
Invoke-Expression $branch.Extent.Text
`);
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapperPath], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, LAGOM_PREP_SOURCE: sourcePath, LAGOM_PREP_PS: powershell,
      LAGOM_PREP_CHILD: childPath, LAGOM_PREP_DONE: path.join(root, 'child-done.txt') },
  });
  assert.equal(result.error, undefined, result.error?.message);
  // Drain the exact harmless child before removing its task-owned directory.
  for (let i = 0; i < 100 && !await fs.stat(path.join(root, 'child-done.txt')).catch(() => null); i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await fs.readFile(path.join(root, 'child-done.txt'), 'utf8'), 'actual-own-child-ready');
  return result;
}

test('ordinary dispatch propagates actual elevated-preparation boundary failure', { skip: process.platform !== 'win32' }, async t => {
  const result = await runPreparation(t, 7);
  assert.equal(result.status, 7, result.stderr);
});

test('ordinary dispatch reports success only after its actual preparation child completed', { skip: process.platform !== 'win32' }, async t => {
  const result = await runPreparation(t, 0);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.dispatched, true);
  assert.notEqual(receipt.elevatedPreparationPending, true);
  assert.equal(receipt.elevatedPreparationCompleted, true);
});

test('preparation wait times out on a held process without accepting a signal file', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(process.env.SHIELD_TEST_WORK_ROOT ?? os.tmpdir(), 'lagom-prep-timeout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const wrapperPath = path.join(root, 'wait.ps1');
  await fs.writeFile(wrapperPath, String.raw`
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:LAGOM_PREP_SOURCE,[ref]$tokens,[ref]$errors)
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-InstallerElevatedPreparation'},$true)
if(-not $definition){throw 'Held-process wait missing'}
Invoke-Expression $definition.Extent.Text
$start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$env:LAGOM_PREP_PS
$start.Arguments='-NoLogo -NoProfile -NonInteractive -Command "Start-Sleep -Seconds 5"'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$held=[Diagnostics.Process]::new();$held.StartInfo=$start;[void]$held.Start()
try {
  try { [void](Wait-InstallerElevatedPreparation -Process $held -TimeoutSeconds 1);throw 'Wait incorrectly succeeded' }
  catch { if($_.Exception.Message -notlike '*preparation exceeded*'){throw} }
} finally {
  # The test owns this exact inert child; production timeout does not kill preparation.
  if(-not $cleanup.HasExited){$cleanup.Kill();[void]$cleanup.WaitForExit(5000)}
  $cleanup.Dispose()
}
` .replace('[void]$held.Start()', '[void]$held.Start();$cleanup=$held'));
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapperPath], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, LAGOM_PREP_SOURCE: sourcePath, LAGOM_PREP_PS: powershell },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

async function updaterFixture(t, spawnImpl, canInstall = async () => true) {
  const root = await fs.mkdtemp(path.join(process.env.SHIELD_TEST_WORK_ROOT ?? os.tmpdir(), 'lagom-prep-inputs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('inert candidate for a preparation-input lifetime regression');
  const candidate = { version: '3.8.1', minimumAppVersion: '3.8.0', tag: 'v3.8.1',
    assetName: 'EgoistShield-Setup-3.8.1.exe', assetUrl: 'https://github.com/egoist-ai1/egoist-lagom/releases/download/v3.8.1/EgoistShield-Setup-3.8.1.exe',
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('hex'), manifestDigest: 'b'.repeat(64), keyId: 'fixture-only' };
  const resourcesPath = path.join(root, 'resources');
  await fs.mkdir(path.join(resourcesPath, 'installer'), { recursive: true });
  for (const name of ['invoke-final-silent-reinstall.ps1', 'ModernInstaller.exe', 'Unbounded.ttf'])
    await fs.writeFile(path.join(resourcesPath, 'installer', name), 'inert boundary fixture');
  const { DesktopUpdater } = loadRecovered('electron/ipc/desktop-updater', {
    path, promises: fs, process, createHash, createReadStream, spawn: (...args) => spawnImpl(root, ...args),
    getNetworkErrorDetails: () => ({ kind: 'unknown' }),
  }, ['DesktopUpdater']);
  const updater = new DesktopUpdater({ currentVersion: '3.8.0', resourcesPath, userDataDir: root, canInstall });
  updater.check = async () => ({ ok: true, phase: 'available', candidate, warnings: [] });
  updater.downloadCandidateWithRetry = async (_candidate, partialPath) => {
    await fs.mkdir(path.dirname(partialPath), { recursive: true });
    await fs.writeFile(partialPath, bytes);
  };
  return { updater, root, bytes, candidate, installer: path.join(root, 'updates', candidate.assetName),
    manifest: path.join(root, 'updates', 'package-integrity.json') };
}

test('failed held helper after actual spawn retains its verified installer and manifest', { skip: process.platform !== 'win32' }, async t => {
  const f = await updaterFixture(t, () => spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 7'], { windowsHide: true, stdio: 'ignore' }));
  const result = await f.updater.checkAndInstall();
  assert.equal(result.failureCode, 'installer-launch-failed');
  assert.equal(result.phase, 'failed');
  assert.deepEqual(await fs.readFile(f.installer), f.bytes);
  const manifest = JSON.parse(await fs.readFile(f.manifest, 'utf8'));
  assert.equal(manifest.installer.sha256.toLowerCase(), f.candidate.sha256);
});

test('failed native spawn without a child still removes the uncommitted candidate', { skip: process.platform !== 'win32' }, async t => {
  const f = await updaterFixture(t, root => spawn(path.join(root, 'nonexistent-preparation.exe'), [], { windowsHide: true, stdio: 'ignore' }));
  const result = await f.updater.checkAndInstall();
  assert.equal(result.failureCode, 'installer-launch-failed');
  assert.equal(await fs.stat(f.installer).catch(() => null), null);
});

test('busy readiness before helper spawn still removes the uncommitted candidate', async t => {
  const f = await updaterFixture(t, () => { throw new Error('Helper must not be spawned'); }, async () => false);
  const result = await f.updater.checkAndInstall();
  assert.equal(result.failureCode, 'busy');
  assert.equal(await fs.stat(f.installer).catch(() => null), null);
});
