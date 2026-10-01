import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('isolated VPN native library retains real shared helper dependencies with inert CIM observations', {
  skip: process.platform !== 'win32',
}, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-vpn-native-acceptance.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    . '${source}' -LibraryOnly;
    foreach($name in @('Resolve-NativeApplication','Assert-NativeAdministratorAcl','Get-NativeCimSnapshot')){[void](Get-Command $name -CommandType Function -ErrorAction Stop)};
    $script:queries=0;
    function Get-CimInstance {
      param($ClassName,$Filter,$OperationTimeoutSec,$ErrorAction)
      if($OperationTimeoutSec -ne 30 -or $ErrorAction -cne 'Stop'){throw 'CIM budget changed'};
      $script:queries++;
      if($ClassName -ceq 'Win32_Service'){
        [pscustomobject]@{Name='EgoistShieldCore';State='Running';StartMode='Auto';StartName='LocalSystem';PathName='C:\\fixture\\Core.exe';ProcessId=42};return
      };
      if($ClassName -ceq 'Win32_Process' -and $Filter -ceq 'ProcessId = 42'){
        [pscustomobject]@{ProcessId=42;ParentProcessId=4;ExecutablePath='C:\\fixture\\Core.exe';CreationDate=[DateTime]::UtcNow};return
      };
      if($ClassName -ceq 'Win32_Process' -and $Filter -ceq "Name = 'EgoistShield.exe'"){return};
      throw ('Unexpected inert observation: '+$ClassName+' / '+$Filter);
    };
    $observation=Assert-NativeService -Name 'EgoistShieldCore' -Executable 'C:\\fixture\\Core.exe' -Running;
    if($observation.process.processId -ne 42){throw 'Complete shared process observation lost'};
    Assert-NativeNoGui;
    if($script:queries -ne 3){throw 'Unexpected shared observation count'};
    @{ok=$true;inertCimQueries=$script:queries;physicalQueries=0;liveMutations=0}|ConvertTo-Json -Compress;
  `;
  const childEnv = path.basename(shell).toLowerCase() === 'powershell.exe'
    ? { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') }
    : process.env;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.inertCimQueries, 3);
  assert.equal(receipt.physicalQueries + receipt.liveMutations, 0);
});
