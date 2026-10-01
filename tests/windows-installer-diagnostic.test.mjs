import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
  path.join(process.env.SystemRoot || '', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const quote = value => value.replaceAll("'", "''");
const library = quote(path.resolve('tests/windows-production-acceptance.ps1'));
const childEnvironment = path.basename(shell).toLowerCase() === 'powershell.exe'
  ? { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') }
  : process.env;
function run(command) {
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: childEnvironment, encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  return JSON.parse(result.stdout);
}

test('native CIM retry returns a complete snapshot and refuses terminal partial reads', { skip: process.platform !== 'win32' }, () => {
  const result = run(`
    $ErrorActionPreference='Stop';
    . '${library}' -LibraryOnly;
    $script:calls=0;
    function Get-CimInstance {
      param($ClassName,$Filter,$OperationTimeoutSec,$ErrorAction)
      if($ClassName -ne 'Win32_Service' -or $Filter -ne "Name='owned'" -or $OperationTimeoutSec -ne 30 -or $ErrorAction -ne 'Stop'){throw 'Query contract changed'};
      $script:calls++;
      if($script:calls -eq 1){throw 'Cold provider timeout fixture'};
      [pscustomobject]@{Name='owned';State='Running'};
    };
    $rows=@(Get-NativeCimSnapshot Win32_Service -Filter "Name='owned'");
    if($script:calls -ne 2 -or $rows.Count -ne 1 -or $rows[0].State -ne 'Running'){throw 'Complete retry result lost'};
    $script:calls=0;
    function Get-CimInstance {$script:calls++;[pscustomobject]@{Name='partial'};throw 'Terminal provider timeout fixture'};
    $returned=@();$refused=$false;
    try{$returned=@(Get-NativeCimSnapshot Win32_Service)}catch{$refused=$true};
    if(-not $refused -or $script:calls -ne 2 -or $returned.Count -ne 0){throw 'Incomplete snapshot was accepted'};
    @{completeRetry=$true;terminalRefused=$true;partialRowsReturned=$returned.Count;liveMutations=0}|ConvertTo-Json -Compress;
  `);
  assert.equal(result.completeRetry, true);
  assert.equal(result.terminalRefused, true);
  assert.equal(result.partialRowsReturned, 0);
  assert.equal(result.liveMutations, 0);
});

test('terminal GUI errors end the wait immediately while transient observations retain retry behavior', { skip: process.platform !== 'win32' }, () => {
  const result = run(`
    $ErrorActionPreference='Stop';. '${library}' -LibraryOnly;
    $watch=[Diagnostics.Stopwatch]::StartNew();$refused=$false;
    try{Wait-NativeCondition -Condition {throw 'Terminal child exit fixture'} -Label 'terminal fixture' -TimeoutSeconds 5 -StopOnError}catch{
      if($_.Exception.Message -cne 'Terminal child exit fixture'){throw};$refused=$true;
    };
    if(-not $refused -or $watch.Elapsed.TotalSeconds -ge 2){throw 'Terminal child exit was lost in retry wait'};
    $script:calls=0;
    $observed=Wait-NativeCondition -Condition {$script:calls++;if($script:calls -eq 1){throw 'Transient observation fixture'};return 'complete'} -Label 'transient fixture' -TimeoutSeconds 2;
    if($observed -cne 'complete' -or $script:calls -ne 2){throw 'Transient retry changed'};
    @{terminalPreserved=$true;transientRecovered=$true}|ConvertTo-Json -Compress;
  `);
  assert.equal(result.terminalPreserved, true);
  assert.equal(result.transientRecovered, true);
});

test('installer diagnostics preserve actual own log bytes and refuse oversized logs', {
  skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_TEMP,
}, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP));
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'installer-diagnostic-'));
  const data = path.join(directory, 'product');
  const work = path.join(directory, 'evidence');
  await fs.mkdir(path.join(data, 'installer'), { recursive: true });
  await fs.mkdir(path.join(data, 'Service'), { recursive: true });
  await fs.mkdir(work);
  const journal = Buffer.from('{"stage":"core-install-failed","fixture":true}\n');
  const coreLog = Buffer.from('owned Core diagnostic fixture\n');
  await fs.writeFile(path.join(data, 'installer/upgrade-journal.json'), journal);
  await fs.writeFile(path.join(data, 'Service/service.log'), coreLog);
  await fs.writeFile(path.join(data, 'Service/service.log.1'), Buffer.alloc(6291457, 46));
  try {
    const records = run(`
      $ErrorActionPreference='Stop';
      function Get-CimInstance {throw 'Diagnostic copy unexpectedly queried SCM'};
      function Get-ScheduledTask {throw 'Diagnostic copy unexpectedly queried Tasks'};
      . '${library}' -LibraryOnly;
      $script:DataRoot='${quote(data)}';$script:Work='${quote(work)}';
      @(Copy-NativeInstallerDiagnostics)|ConvertTo-Json -Depth 6 -Compress;
    `);
    assert.equal(records.length, 3);
    assert.equal(records[0].status, 'captured', JSON.stringify(records[0]));
    assert.equal(records[1].status, 'captured', JSON.stringify(records[1]));
    assert.equal(records[2].status, 'refused-or-unavailable');
    assert.match(records[2].error, /exceeded its explicit bound/);
    assert.deepEqual(await fs.readFile(path.join(work, 'installer-upgrade-journal.jsonl')), journal);
    assert.deepEqual(await fs.readFile(path.join(work, 'core-service.log')), coreLog);
    assert.deepEqual((await fs.readdir(work)).sort(), ['core-service.log', 'installer-upgrade-journal.jsonl']);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('signed Setup and source Core diagnostics refuse a physical host before reading inputs or compiling', { skip: process.platform !== 'win32' }, () => {
  for (const parameters of [['-SignedCandidateAssetsDirectory', 'C:/nonexistent-diagnostic-fixture'], ['-CoreConfigurationOnly'],
    ['-SignedCandidateAssetsDirectory', 'C:/nonexistent-diagnostic-fixture', '-OriginalAssetsDirectory', 'C:/nonexistent-original-fixture', '-OriginalVersion', '3.7.8', '-GuiFailureDiagnostic']]) {
    const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      path.resolve('tests/windows-installer-diagnostics.ps1'), ...parameters], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' },
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Native acceptance host guard refused before mutation/);
    assert.doesNotMatch(result.stderr, /nonexistent-diagnostic-fixture|DOTNET_INSTALL_DIR|core-diagnostic-publish/);
  }
});

test('GUI failure diagnostics read only the launched profile log and retain actual bytes within the bound', {
  skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_TEMP,
}, async () => {
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'gui-log-diagnostic-'));
  const appData = path.join(directory, 'launch-profile');
  const source = path.join(appData, 'Egoist Shield/logs/main.log');
  const work = path.join(directory, 'evidence');
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.mkdir(work);
  const bytes = Buffer.from('[boot] app startup failed: inert diagnostic fixture\r\n');
  await fs.writeFile(source, bytes);
  try {
    const captured = run(`
      $ErrorActionPreference='Stop';
      . '${library}' -LibraryOnly;
      $script:Work='${quote(work)}';
      $info=[Diagnostics.ProcessStartInfo]::new();$info.Environment['APPDATA']='${quote(appData)}';
      Copy-NativeGuiLog -StartInfo $info -Label 'launched-profile'|ConvertTo-Json -Compress;
    `);
    assert.equal(captured.status, 'captured', JSON.stringify(captured));
    assert.equal(captured.bytes, bytes.length);
    assert.deepEqual(await fs.readFile(path.join(work, 'launched-profile-main.log')), bytes);
    await fs.writeFile(source, Buffer.alloc(6291457, 46));
    const refused = run(`
      $ErrorActionPreference='Stop';
      . '${library}' -LibraryOnly;
      $script:Work='${quote(work)}';
      $info=[Diagnostics.ProcessStartInfo]::new();$info.Environment['APPDATA']='${quote(appData)}';
      Copy-NativeGuiLog -StartInfo $info -Label 'oversized-profile'|ConvertTo-Json -Compress;
    `);
    assert.equal(refused.status, 'refused-or-unavailable');
    assert.match(refused.error, /exceeded its explicit bound/);
    assert.deepEqual(await fs.readdir(work), ['launched-profile-main.log']);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('native runtime resolution selects the first real PATH result when two applications share a name', {
  skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_TEMP,
}, async () => {
  assert.ok(path.isAbsolute(process.env.LAGOM_TEST_TEMP));
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'native-resolver-'));
  const candidates = [path.join(directory, 'first'), path.join(directory, 'second')];
  const name = 'lagom-native-resolution-fixture.exe';
  for (const candidate of candidates) {
    await fs.mkdir(candidate);
    await fs.writeFile(path.join(candidate, name), 'inert file; never launched');
  }
  try {
    const result = run(`
      $ErrorActionPreference='Stop';
      . '${library}' -LibraryOnly;
      $env:PATH='${quote(candidates.join(';'))};'+$env:PATH;
      $all=@(Get-Command -Name '${name}' -CommandType Application -ErrorAction Stop);
      if($all.Count -ne 2){throw 'Actual duplicate PATH results were not reproduced'};
      $resolved=Resolve-NativeApplication '${name}';
      if($resolved -cne $all[0].Source){throw 'Preferred native executable changed'};
      @{candidates=$all.Count;resolved=$resolved}|ConvertTo-Json -Compress;
    `);
    assert.equal(result.candidates, 2);
    assert.equal(result.resolved, path.join(candidates[0], name));
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('native ACL diagnostics capture actual owner and each raw ACE without changing permissions', {
  skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_TEMP,
}, async () => {
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'native-acl-readback-'));
  try {
    const result = run(`
      $ErrorActionPreference='Stop';
      . '${library}' -LibraryOnly;
      $path='${quote(directory)}';
      $before=Get-Acl -LiteralPath $path;
      $snapshot=Get-NativePathAclSnapshot $path;
      $after=Get-Acl -LiteralPath $path;
      if($snapshot.path -cne $path -or $snapshot.sddl -cne $before.Sddl -or $after.Sddl -cne $before.Sddl){throw 'ACL snapshot changed or lost actual descriptor'};
      if($snapshot.owner -cne $before.GetOwner([Security.Principal.SecurityIdentifier]).Value){throw 'ACL snapshot lost actual owner'};
      $rules=@($before.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));
      if($snapshot.rules.Count -ne $rules.Count){throw 'ACL snapshot lost an ACE'};
      for($i=0;$i -lt $rules.Count;$i++){
        $actual=$snapshot.rules[$i];$expected=$rules[$i];
        if($actual.sid -cne $expected.IdentityReference.Value -or $actual.rights -ne [int]$expected.FileSystemRights -or $actual.type -cne [string]$expected.AccessControlType -or $actual.inherited -ne $expected.IsInherited -or $actual.inheritance -ne [int]$expected.InheritanceFlags -or $actual.propagation -ne [int]$expected.PropagationFlags){throw 'ACL snapshot changed an actual ACE'};
      };
      @{ok=$true;aceCount=$rules.Count;liveMutations=0}|ConvertTo-Json -Compress;
    `);
    assert.equal(result.ok, true);
    assert.ok(result.aceCount > 0);
    assert.equal(result.liveMutations, 0);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
