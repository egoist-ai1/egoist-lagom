import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { acceptanceEnvironmentErrors, relativePayloadPath } from './windows-production-acceptance.mjs';

const hosted = {
  GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows',
  GITHUB_REPOSITORY: 'egoist-ai1/egoist-lagom', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: 'a'.repeat(40),
};

test('native acceptance refuses missing or mismatched hosted runner identities', () => {
  assert.deepEqual(acceptanceEnvironmentErrors(hosted), []);
  for (const key of Object.keys(hosted)) {
    assert.ok(acceptanceEnvironmentErrors({ ...hosted, [key]: '' }).includes(key), key);
    assert.ok(acceptanceEnvironmentErrors({ ...hosted, [key]: 'foreign' }).includes(key), key);
  }
  assert.ok(acceptanceEnvironmentErrors({ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }).includes('RUNNER_ENVIRONMENT'));
});

test('native payload readback refuses traversal, drive paths and alternate path separators', () => {
  const root = path.resolve('fixture-install-root');
  assert.equal(relativePayloadPath(root, 'resources/app.asar'), path.join(root, 'resources', 'app.asar'));
  for (const malicious of ['../foreign.exe', 'resources/../foreign.exe', '/foreign.exe', 'C:/foreign.exe',
    'resources\\foreign.exe', 'resources//foreign.exe', 'resources/./foreign.exe', 'resources/app.asar:stream', ''])
    assert.throws(() => relativePayloadPath(root, malicious), malicious);
});

test('PowerShell native acceptance host guard and path boundary perform no mutations', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    function Get-CimInstance { throw 'Library import unexpectedly queried SCM/processes' }
    function Get-ScheduledTask { throw 'Library import unexpectedly queried Tasks' }
    function New-Item { throw 'Library import unexpectedly created filesystem/registry state' }
    . '${source}' -LibraryOnly;
    $environment=@{GITHUB_ACTIONS='true';CI='true';RUNNER_ENVIRONMENT='github-hosted';RUNNER_OS='Windows';GITHUB_REPOSITORY='egoist-ai1/egoist-lagom';GITHUB_RUN_ID='123';GITHUB_RUN_ATTEMPT='1';GITHUB_SHA=('a'*40)};
    if(@(Get-NativeAcceptanceEnvironmentErrors $environment $true $true).Count -ne 0){throw 'Valid hosted environment rejected'};
    if('ElevatedAdministrator' -notin @(Get-NativeAcceptanceEnvironmentErrors $environment $false $true)){throw 'Nonadministrator accepted'};
    if('Windows' -notin @(Get-NativeAcceptanceEnvironmentErrors $environment $true $false)){throw 'NonWindows accepted'};
    foreach($name in @($environment.Keys)){
      $copy=$environment.Clone();$copy[$name]='foreign';
      if($name -notin @(Get-NativeAcceptanceEnvironmentErrors $copy $true $true)){throw ('Bad guard field accepted: '+$name)};
    };
    $root=[IO.Path]::GetFullPath('C:\\acceptance-root');
    if((Assert-NativePathWithin 'C:\\acceptance-root\\owned\\file.exe' $root) -ne 'C:\\acceptance-root\\owned\\file.exe'){throw 'Valid boundary rejected'};
    foreach($candidate in @('C:\\acceptance-root-sibling\\file.exe','C:\\acceptance-root\\..\\foreign.exe','D:\\foreign.exe','relative.exe',$root)){
      $refused=$false;try{[void](Assert-NativePathWithin $candidate $root)}catch{$refused=$true};if(-not $refused){throw ('Bad path accepted: '+$candidate)};
    };
    @{groups=4;liveScmMutations=0;liveDnsMutations=0;liveTaskMutations=0;liveRegistryMutations=0}|ConvertTo-Json -Compress
  `;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.groups, 4);
  assert.equal(receipt.liveScmMutations + receipt.liveDnsMutations + receipt.liveTaskMutations + receipt.liveRegistryMutations, 0);
});

test('an actual native acceptance invocation refuses a non-hosted process before input or mutation', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve('tests/windows-production-acceptance.ps1'), '-Mode', 'GuardOnly'], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' },
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Native acceptance host guard refused before mutation/);
  assert.match(result.stderr, /GITHUB_ACTIONS/);
  assert.match(result.stderr, /RUNNER_ENVIRONMENT/);
});

test('native child timeout retires its own process and retains bounded stdout, stderr and failure evidence', { skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_POWERSHELL || !process.env.LAGOM_TEST_TEMP }, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP));
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'native-timeout-'));
  const quote = value => value.replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';
    . '${quote(path.resolve('tests/windows-production-acceptance.ps1'))}' -LibraryOnly;
    $script:Work='${quote(directory)}';
    $refused=$false;
    try{[void](Invoke-NativeBounded -Executable '${quote(process.execPath)}' -Arguments @('-e','process.stdout.write("owned stdout marker\\n");process.stderr.write("owned stderr marker\\n");setInterval(()=>{},1000)') -Label 'owned-timeout' -TimeoutSeconds 1)}catch{
      if($_.Exception.Message -notmatch 'bounded timeout evidence retained'){throw};$refused=$true
    };
    if(-not $refused){throw 'Hung child was reported successful'};
    $receipt=Get-Content -LiteralPath (Join-Path $script:Work 'owned-timeout.timeout.json') -Raw|ConvertFrom-Json;
    if(-not $receipt.exitObserved -or -not $receipt.stdoutComplete -or -not $receipt.stderrComplete){throw 'Actual owned child retirement or bounded drain failed'};
    if((Get-Content -LiteralPath (Join-Path $script:Work 'owned-timeout.stdout.txt') -Raw) -notmatch 'owned stdout marker'){throw 'stdout lost'};
    if((Get-Content -LiteralPath (Join-Path $script:Work 'owned-timeout.stderr.txt') -Raw) -notmatch 'owned stderr marker'){throw 'stderr lost'};
    $receipt|ConvertTo-Json -Compress
  `;
  try {
    const result = spawnSync(process.env.LAGOM_TEST_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.result, 'failed-timeout');
    assert.equal(receipt.timeoutSeconds, 1);
    assert.ok(receipt.elapsedMilliseconds < 10000);
    assert.equal(receipt.killError, null);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
