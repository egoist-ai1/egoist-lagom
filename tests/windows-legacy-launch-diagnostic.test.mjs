import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = path.resolve(import.meta.dirname, '..');
const adapter = path.join(project, 'tests/windows-legacy-launch-diagnostic.ps1');
const source = readFileSync(path.join(project, 'tests/windows-legacy-launch-diagnostic.cs'), 'utf8');
const winPs = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => `'${value.replaceAll("'", "''")}'`;
const windows = process.platform === 'win32' && existsSync(winPs);
function runPs(script) {
  const result = spawnSync(winPs, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('the diagnostic cannot resume or grant acceptance to a sampled process', () => {
  assert.doesNotMatch(source, /extern\s+\w+\s+ResumeThread\s*\(/);
  assert.doesNotMatch(source, /--(?:no-sandbox|disable-gpu-sandbox|disable-gpu)|RUNASINVOKER/);
  assert.match(source, /actualChromiumGpuErrorCaptured=false/);
  assert.match(source, /chromiumTokenEquivalent=false/);
  assert.match(source, /acceptance=false/);
  assert.match(source, /int nativeError=Marshal\.GetLastPInvokeError\(\); \/\/ Capture immediately/);
});

test('PowerShell library import preserves the caller and refuses a physical host before product lookup', { skip: !windows }, () => {
  const output = runPs(`$ErrorActionPreference='Stop'; $LibraryOnly=$false; $Mode='caller'; $script:Work='caller-work'; $script:Receipt=@{marker='caller'}; . ${quote(adapter)} -LibraryOnly; if($LibraryOnly -or $Mode -ne 'caller' -or $script:Work -ne 'caller-work' -or $script:Receipt.marker -ne 'caller'){throw 'Caller overwritten'}; $errors=@(Get-LegacyLaunchDiagnosticEnvironmentErrors -Environment @{} -Administrator $false -Windows $true); if($errors.Count -lt 8){throw 'Host guard omitted fields'}; if(-not $env:GITHUB_ACTIONS){try { Invoke-LegacyLaunchDiagnostic -InstalledGuiPath 'C:\\absent-product\\EgoistShield.exe' -ExpectedGuiSha256 '${'0'.repeat(64)}' -ExpectedOldVersion '3.7.9' -WorkRoot 'C:\\absent-work' -EvidenceDirectory 'C:\\absent-evidence' -ExpectedSourceCommit '${'0'.repeat(40)}'; throw 'Local invocation admitted' } catch { if($_.Exception.Message -notmatch 'hosted guard refused before product lookup'){throw} }}; 'guard-isolation-pass'`);
  assert.equal(output, 'guard-isolation-pass');
});

test('PowerShell 5.1 parses the adapter without running product code', { skip: !windows }, () => {
  assert.equal(runPs(`$tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile(${quote(adapter)},[ref]$tokens,[ref]$errors); if($errors.Count -ne 0){throw ($errors|Out-String)}; 'parse-pass'`), 'parse-pass');
});

test('an explicitly missing SDK is rejected without falling back to PATH', { skip: !windows }, () => {
  assert.equal(runPs(`$ErrorActionPreference='Stop'; . ${quote(adapter)} -LibraryOnly; $saved=$env:SHIELD_DOTNET; try { $env:SHIELD_DOTNET='C:\\nonexistent-legacy-diagnostic-sdk\\dotnet.exe'; try { Build-LegacyLaunchDiagnostic -WorkRoot ${quote(project)}; throw 'Missing explicit SDK admitted' } catch { if($_.Exception.Message -notmatch 'Explicit SHIELD_DOTNET does not exist'){throw} }; 'explicit-sdk-refused' } finally { $env:SHIELD_DOTNET=$saved }`), 'explicit-sdk-refused');
});
