import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

test('protected reinstall emits branded progress, success and failure states', { skip: process.platform !== 'win32' }, async () => {
  const source = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1', 'utf8');
  const start = source.indexOf('function Write-BrandedInstallerStatus {');
  const end = source.indexOf('function Add-ReceiptEvent {', start);
  assert.ok(start >= 0 && end > start);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-branded-status-'));
  const scriptPath = path.join(directory, 'probe.ps1');
  const stageLiteral = directory.replaceAll("'", "''");
  const lines = [
    "\uFEFF$ErrorActionPreference = 'Stop'",
    `$StageDirectory = '${stageLiteral}'`,
    source.slice(start, end),
    "Write-BrandedInstallerStatus -Stage 'dispatch' -Status 'dispatched'",
    "$begin = Get-Content -LiteralPath (Join-Path $StageDirectory 'status.txt') -Raw",
    "Write-BrandedInstallerStatus -Stage 'installer' -Status 'installer-exited' -Data @{ exitCode = 43 }",
    "$recovering = Get-Content -LiteralPath (Join-Path $StageDirectory 'status.txt') -Raw",
    "Write-BrandedInstallerStatus -Stage 'verify' -Status 'succeeded'",
    "$done = Get-Content -LiteralPath (Join-Path $StageDirectory 'status.txt') -Raw",
    "Write-BrandedInstallerStatus -Stage 'recovery' -Status 'recovery-warning'",
    "$failed = Get-Content -LiteralPath (Join-Path $StageDirectory 'status.txt') -Raw",
    "if (-not ([string]$begin).StartsWith('8|')) { throw 'start status missing' }",
    "if (-not ([string]$recovering).StartsWith('88|')) { throw 'early terminal error while recovery is pending' }",
    "if ([string]$done -ne '100|DONE') { throw 'success status missing' }",
    "if (-not ([string]$failed).StartsWith('0|ERROR:')) { throw 'failure status missing' }",
    "Write-Output 'PASS'",
  ];
  try {
    await fs.writeFile(scriptPath, lines.join('\n'));
    const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true, timeout: 15000 });
    assert.equal(stdout.trim(), 'PASS');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('worker failure before service changes ends the branded monitor with an error', { skip: process.platform !== 'win32' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-worker-early-failure-'));
  try {
    let failed = false;
    try {
      await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/invoke-final-silent-reinstall.ps1', '-Worker', '-StageDirectory', directory], { windowsHide: true, timeout: 15000 });
    } catch { failed = true; }
    assert.equal(failed, true);
    assert.equal((await fs.readFile(path.join(directory, 'complete.flag'), 'utf8')).trim(), 'worker-failed');
    assert.match(await fs.readFile(path.join(directory, 'status.txt'), 'utf8'), /^0\|ERROR:/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('protected updater records a readable final result for the relaunched app', { skip: process.platform !== 'win32' }, async () => {
  const source = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1', 'utf8');
  const start = source.indexOf('function Write-DesktopUpdateResult {');
  const end = source.indexOf('function Add-ReceiptEvent {', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.match(/function Start-InstalledDesktop \{[\s\S]*?\n\}/)?.[0] ?? '', /--background|--minimized|WindowStyle Hidden/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shield-update-result-'));
  const scriptPath = path.join(directory, 'probe.ps1');
  try {
    await fs.writeFile(scriptPath, [
      '\uFEFF$ErrorActionPreference = "Stop"',
      `$script:OwnedDataRoot = '${directory.replaceAll("'", "''")}'`,
      source.slice(start, end),
      '$state = [pscustomobject]@{ fromVersion = "3.7.5"; version = "3.7.6" }',
      'Write-DesktopUpdateResult -State $state -Ok $true -Message "Службы и DNS проверены."'
    ].join('\n'));
    await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true, timeout: 15000 });
    const bytes = await fs.readFile(path.join(directory, 'Installer', 'last-update-result.json'));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const result = JSON.parse(bytes.toString('utf8'));
    assert.equal(result.ok, true);
    assert.equal(result.fromVersion, '3.7.5');
    assert.equal(result.toVersion, '3.7.6');
    assert.match(result.message, /Службы и DNS проверены/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
