import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('installation ACL accepts exact TrustedInstaller only in canonical Program Files and refuses unsafe private descriptors', {
  skip: process.platform !== 'win32',
}, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const library = path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    function Get-Acl {throw 'Descriptor boundary unexpectedly read a physical ACL'};
    function Set-Acl {throw 'Descriptor boundary unexpectedly changed a physical ACL'};
    function Get-CimInstance {throw 'Descriptor boundary unexpectedly queried services'};
    . '${library}' -LibraryOnly;
    $root=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield';
    $ti='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
    $private=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield\\Service\\config.json';
    function New-Descriptor([string]$sddl){$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetSecurityDescriptorSddlForm($sddl);return $acl};
    function Assert-Refused([string]$sddl,[string]$scope,[bool]$installation){
      $refused=$false;try{Assert-NativeAdministratorAcl (New-Descriptor $sddl) $scope -InstallationPath:$installation}catch{$refused=$true};
      if(-not $refused){throw ('Unsafe descriptor or scope accepted: '+$sddl+' / '+$scope)};
    };
    $observed='O:BAD:AI(A;ID;FA;;;'+$ti+')(A;CIIOID;GA;;;'+$ti+')(A;ID;FA;;;SY)(A;OICIIOID;GA;;;SY)(A;ID;FA;;;BA)(A;OICIIOID;GA;;;BA)(A;ID;0x1200a9;;;BU)(A;OICIIOID;GXGR;;;BU)(A;OICIIOID;GA;;;CO)';
    foreach($scope in @($root,($root+'\\resources'),($root+'\\resources\\app.asar'))){Assert-NativeAdministratorAcl (New-Descriptor $observed) $scope -InstallationPath};
    Assert-NativeAdministratorAcl (New-Descriptor ('O:'+ $ti +'D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;'+$ti+')')) $root -InstallationPath;
    foreach($scope in @($root,($root+'\\resources'),$private)){Assert-Refused $observed $scope $false};
    foreach($scope in @($private,($root+'-foreign\\app.asar'),($root+'\\..\\foreign\\app.asar'),'relative.exe')){Assert-Refused $observed $scope $true};
    Assert-Refused ('O:'+ $ti +'D:(A;;FA;;;SY)(A;;FA;;;BA)') $private $false;
    foreach($owner in @('BU','S-1-5-21-1-2-3-1001','S-1-3-0')){Assert-Refused ('O:'+ $owner +'D:(A;;FA;;;SY)(A;;FA;;;BA)') $root $true};
    foreach($right in @('0x2','0x4','0x10','0x100','0x40','0x10000','0x40000','0x80000')){Assert-Refused ('O:BAD:(A;;FA;;;SY)(A;;FA;;;BA)(A;;'+$right+';;;BU)') $root $true};
    Assert-Refused 'O:BAD:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-3-0)' $root $true;
    Assert-Refused 'O:BAD:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478465)' $root $true;
    Assert-NativeAdministratorAcl (New-Descriptor 'O:BAD:(A;;FA;;;SY)(A;;FA;;;BA)(A;OICIIO;GA;;;CO)(A;;0x1200a9;;;BU)') $private;
    @{positiveCases=5;negativeCases=21;inMemoryDescriptorsOnly=$true;physicalAclReads=0;physicalAclWrites=0;liveMutations=0}|ConvertTo-Json -Compress;
  `;
  const childEnv = path.basename(shell).toLowerCase() === 'powershell.exe'
    ? { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') }
    : process.env;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: childEnv, windowsHide: true, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.positiveCases, 5);
  assert.equal(receipt.negativeCases, 21);
  assert.equal(receipt.inMemoryDescriptorsOnly, true);
  assert.equal(receipt.physicalAclReads + receipt.physicalAclWrites + receipt.liveMutations, 0);
});
