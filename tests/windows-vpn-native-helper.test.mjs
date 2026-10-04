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


test('Vpn elevated GUI receipt guard rejects medium/foreign/malformed launch proofs without launching a product', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-vpn-native-acceptance.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    . '${source}' -LibraryOnly;
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$process=[Diagnostics.Process]::GetCurrentProcess();
    try{$sid=$identity.User.Value;$session=$process.SessionId}finally{$identity.Dispose();$process.Dispose()};
    $script:VpnGui=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\EgoistShield.exe';$script:VpnSourceCommit='a'*40;
    $token=@{elevated=$true;administratorsEnabled=$true;integrityRid=12288;uiAccess=$false;tokenType=1;userSid=$sid;sessionId=$session};
    $template=@{launchPolicy='elevated';elevatedGui=$true;guiRequestedExecutionLevel='asInvoker';arguments=@();executable=$script:VpnGui;source=@{commit=$script:VpnSourceCommit};token=$token;runnerToken=$token}|ConvertTo-Json -Depth 6;
    $valid=$template|ConvertFrom-Json;Assert-VpnElevatedGuiProof $valid;
    $mutations=@(
      {$args[0].token.integrityRid=8192},{$args[0].token.elevated=$false},{$args[0].token.administratorsEnabled=$false},
      {$args[0].token.uiAccess=$true},{$args[0].token.tokenType=2},{$args[0].token.userSid=$sid+'-foreign'},{$args[0].token.sessionId=$session+1},
      {$args[0].runnerToken.userSid=$sid+'-foreign'},{$args[0].runnerToken.sessionId=$session+1},{$args[0].runnerToken.integrityRid=8192},
      {$args[0].runnerToken.elevated=$false},{$args[0].runnerToken.administratorsEnabled=$false},{$args[0].runnerToken.tokenType=2},
      {$args[0].guiRequestedExecutionLevel='requireAdministrator'},{$args[0].launchPolicy='ordinary'},{$args[0].elevatedGui=$false},{$args[0].elevatedGui='true'},{$args[0].arguments=@('--override')},
      {$args[0].executable+='-foreign'},{$args[0].source.commit='b'*40},{$args[0].token.elevated='true'},{$args[0].token.integrityRid='12288'},
      {$args[0].PSObject.Properties.Remove('launchPolicy')}
    );
    $refused=0;foreach($mutation in $mutations){$proof=$template|ConvertFrom-Json;& $mutation $proof;$rejected=$false;try{Assert-VpnElevatedGuiProof $proof}catch{$rejected=$true};if(-not $rejected){throw ('Malformed receipt accepted at case '+$refused)};$refused++};
    @{validControlledShapeAccepted=$true;refused=$refused;controlledInputs=$true;actualGuiLaunches=0;liveMutations=0;nativeAcceptancePassed=$false}|ConvertTo-Json -Compress;
  `;
  const env = { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' };
  if (path.basename(shell).toLowerCase() === 'powershell.exe') for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, [result.error?.code, result.signal, result.stdout, result.stderr].filter(Boolean).join('\n'));
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.validControlledShapeAccepted, true); assert.equal(receipt.refused, 23);
  assert.equal(receipt.actualGuiLaunches + receipt.liveMutations, 0); assert.equal(receipt.nativeAcceptancePassed, false);
});
