import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const execFileAsync = promisify(execFile);

test('protected upgrade migrates verified stopped wrappers and restores their original bytes on failure', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP || ''), 'Set task-scoped LAGOM_TEST_TEMP.');
  const { stdout, stderr } = await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests', 'installer-wrapper-migration.ps1')], { cwd: root, windowsHide: true, timeout: 30_000 });
  assert.equal(stderr.trim(), '');
  assert.match(stdout, /Wrapper migration checks: 21 passed/);
});

test('worker and watchdog persist handoff before stops and gate rollback before handoff', async () => {
  const source = await fs.readFile(path.join(root, 'scripts', 'invoke-final-silent-reinstall.ps1'), 'utf8');
  const worker = source.match(/function Invoke-WorkerMode[\s\S]*?\r?\n}\r?\n\r?\nif \(\$Watchdog\)/)?.[0] || '';
  assert.ok(worker.indexOf('Assert-SupportedServiceFramework') < worker.indexOf('$mutex ='));
  assert.ok(worker.indexOf('$state.handoffStarted = $true') < worker.indexOf('Stop-OwnedProcesses'));
  assert.match(worker, /\$state\.handoffStarted = \$true\r?\n\s+Write-JsonAtomic[^\n]+\r?\n\s+Stop-OwnedProcesses/);
  assert.match(worker, /if \(\$state\.handoffStarted -eq \$true\)/);
  assert.match(source, /if \(-not \$state\.PSObject\.Properties\['handoffStarted'\] -or \$state\.handoffStarted -eq \$true\)/);
  const migration = worker.indexOf('Update-PreservedServiceWrappers');
  assert.ok(migration > worker.indexOf('Restore-PreservedState') && migration < worker.indexOf('Start-PreservedServices'));
});
