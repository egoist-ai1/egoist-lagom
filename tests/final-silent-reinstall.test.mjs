import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'scripts', 'invoke-final-silent-reinstall.ps1');
const manifest = path.join(root, 'dist', 'package-integrity.json');
const releaseVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const artifactReady = existsSync(manifest) && existsSync(path.join(root, 'dist', `EgoistShield-Setup-${releaseVersion}.exe`));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('deferred reinstall plan validates the exact release without touching services', { skip: process.platform !== 'win32' || !artifactReady }, async () => {
  const integrity = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const installer = path.join(root, 'dist', `EgoistShield-Setup-${integrity.version}.exe`);
  const { stdout, stderr } = await execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-InstallerPath', installer,
    '-IntegrityManifestPath', manifest,
    '-ExpectedVersion', integrity.version,
    '-ExpectedSha256', integrity.installer.sha256,
    '-PlanOnly'
  ], { cwd: root, windowsHide: true, timeout: 30_000 });
  assert.equal(stderr.trim(), '');
  const plan = JSON.parse(stdout);
  assert.equal(plan.ready, true);
  assert.equal(plan.version, integrity.version);
  assert.equal(plan.sha256, integrity.installer.sha256);
  assert.equal(plan.dnsStopOrder, 'last');
});

test('deferred reinstall rejects a checksum mismatch before dispatch', { skip: process.platform !== 'win32' || !artifactReady }, async () => {
  const integrity = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const installer = path.join(root, 'dist', `EgoistShield-Setup-${integrity.version}.exe`);
  await assert.rejects(execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-InstallerPath', installer,
    '-IntegrityManifestPath', manifest,
    '-ExpectedVersion', integrity.version,
    '-ExpectedSha256', '0'.repeat(64),
    '-PlanOnly'
  ], { cwd: root, windowsHide: true, timeout: 30_000 }), /Expected SHA-256 does not match/);
});

test('embedded installer dispatch validates itself without an external manifest', { skip: process.platform !== 'win32' || !artifactReady }, async () => {
  const integrity = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const installer = path.join(root, 'dist', `EgoistShield-Setup-${integrity.version}.exe`);
  const { stdout, stderr } = await execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-InstallerPath', installer,
    '-ExpectedVersion', integrity.version,
    '-EmbeddedRelease',
    '-PlanOnly'
  ], { cwd: root, windowsHide: true, timeout: 30_000 });
  assert.equal(stderr.trim(), '');
  const plan = JSON.parse(stdout);
  assert.equal(plan.ready, true);
  assert.equal(plan.version, integrity.version);
  assert.equal(plan.sha256, integrity.installer.sha256);
  assert.equal(plan.dnsStopOrder, 'last');
});

test('embedded installer dispatch rejects a PE with the wrong product identity', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(execFileAsync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-InstallerPath', process.execPath,
    '-ExpectedVersion', '3.7.3',
    '-EmbeddedRelease',
    '-PlanOnly'
  ], { cwd: root, windowsHide: true, timeout: 30_000 }), /product identity is invalid/);
});

test('worker starts watchdog before service stops and stops SystemDoH last', async () => {
  const source = await fs.readFile(script, 'utf8');
  const worker = source.match(/function Invoke-WorkerMode[\s\S]*?\r?\n}\r?\n\r?\nif \(\$Watchdog\)/)?.[0] ?? '';
  const watchdogStart = worker.indexOf('Start-Process -FilePath $powerShell');
  const runtimeBackup = worker.indexOf('Invoke-RobocopyDirectory -Source $script:RuntimeRoot');
  const dnsBackup = worker.indexOf('Backup-CriticalDnsState');
  const ordinaryStops = worker.indexOf('foreach ($name in @("EgoistShieldTelegramProxy"');
  const dnsStop = worker.indexOf('Stop-OwnedServiceForInstall -Name "EgoistShieldSystemDoH"');
  const installerStart = worker.indexOf('$installerProcess = Start-Process');
  assert.ok(watchdogStart >= 0 && watchdogStart < ordinaryStops);
  assert.ok(dnsBackup >= 0 && runtimeBackup >= 0 && runtimeBackup < dnsStop);
  assert.ok(ordinaryStops < dnsStop && dnsStop < installerStart);
  assert.match(source, /Reset-CriticalLoopbackDnsToDhcp/);
  assert.match(source, /Restore-PreservedState/);
  assert.match(source, /Test-LoopbackDnsReady/);
  assert.match(source, /Restore-CriticalAdapterDns -State \$state/);
  assert.match(source, /Could not re-register .*with the service manager/);
  assert.match(source, /Restore-CriticalDnsState -State \$State/);
});

test('embedded dispatch stages a canonical versioned installer and generates the worker manifest', async () => {
  const source = await fs.readFile(script, 'utf8');
  assert.match(source, /Get-ValidatedEmbeddedRelease/);
  assert.match(source, /EgoistShield-Setup-\$\(\$release\.version\)\.exe/);
  assert.match(source, /Write-JsonAtomic -Path \$stagedManifest/);
  assert.match(source, /if \(\$release\.manifest\)/);
});
