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
    "Write-BrandedInstallerStatus -Stage 'desktop' -Status 'desktop-launch-failed'",
    "$desktopFailed = Get-Content -LiteralPath (Join-Path $StageDirectory 'status.txt') -Raw -Encoding UTF8",
    "if (-not ([string]$begin).StartsWith('8|')) { throw 'start status missing' }",
    "if (-not ([string]$recovering).StartsWith('88|')) { throw 'early terminal error while recovery is pending' }",
    "if ([string]$done -ne '100|DONE') { throw 'success status missing' }",
    "if (-not ([string]$failed).StartsWith('0|ERROR:')) { throw 'failure status missing' }",
    "if ([string]$desktopFailed -ne '0|ERROR: Службы и DNS восстановлены. Не удалось запустить приложение; подробности в журнале установки.') { throw 'verified recovery and desktop launch failure were not distinguished' }",
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
    assert.match(await fs.readFile(path.join(directory, 'status.txt'), 'utf8'), /^0\|ERROR: Установка не завершена/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('protected updater records a readable final result for the relaunched app', { skip: process.platform !== 'win32' }, async () => {
  const source = await fs.readFile('scripts/invoke-final-silent-reinstall.ps1', 'utf8');
  const start = source.indexOf('function Write-DesktopUpdateResult {');
  const end = source.indexOf('function Add-ReceiptEvent {', start);
  assert.ok(start >= 0 && end > start);
  const desktopRestart = source.match(/function Start-InstalledDesktop \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(desktopRestart, /if \(\$minimized\)/);
  assert.match(desktopRestart, /else \{\s+Start-Process -FilePath \$exe -WorkingDirectory \$script:OwnedInstallRoot \| Out-Null/);
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

test('pre-handoff worker failure remains visible when its diagnostic journal cannot be written', {skip:process.platform!=='win32'}, async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shield-worker-journal-failure-'));
  const scriptPath=path.join(directory,'probe.ps1');
  const literal=(value)=>value.replaceAll("'","''");
  try {
    await fs.writeFile(scriptPath,[
      '\uFEFF$ErrorActionPreference="Stop"',
      `$source='${literal(path.resolve('scripts/invoke-final-silent-reinstall.ps1'))}'`,
      '$tokens=$null;$errors=$null',
      '$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)',
      'if($errors.Count){throw "Production script did not parse"}',
      '$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Write-BrandedInstallerStatus"},$true)',
      '. ([scriptblock]::Create($fn.Extent.Text))',
      '$clause=$ast.Find({param($n)$n -is [Management.Automation.Language.IfStatementAst] -and $n.Clauses[0].Item1.Extent.Text -eq "$"+"Worker"},$true)',
      'if(-not $clause){throw "Production worker dispatch is missing"}',
      `$StageDirectory='${literal(directory)}';$Worker=$true`,
      'function Resolve-FullPath {param($Path,[switch]$MustExist) [IO.Path]::GetFullPath($Path)}',
      'function Invoke-WorkerMode {throw "Fixture pre-handoff failure"}',
      'function Test-InstallerServiceMaintenanceOwner {return $false}',
      'function Add-ReceiptEvent {throw "Fixture journal unavailable"}',
      '$reason=$null;try {& ([scriptblock]::Create($clause.Extent.Text))} catch {$reason=$_.Exception.Message}',
      'if($reason -ne "Fixture pre-handoff failure"){throw ("Original worker error was lost: "+$reason)}',
      'Write-Output "PASS: diagnostic failure does not suppress the terminal pre-handoff error"',
    ].join('\n'));
    const {stdout}=await run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath],{windowsHide:true,timeout:15000});
    assert.match(stdout,/PASS: diagnostic failure/);
    assert.equal((await fs.readFile(path.join(directory,'complete.flag'),'utf8')).trim(),'worker-failed');
    assert.match(await fs.readFile(path.join(directory,'status.txt'),'utf8'),/^0\|ERROR: Установка не завершена/);
  } finally {
    assert.equal(await fs.realpath(directory),directory);
    await fs.rm(directory,{recursive:true,force:true});
  }
});
