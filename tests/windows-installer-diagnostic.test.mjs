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

test('signed installer diagnostic refuses a physical host before reading candidate assets', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
    path.resolve('tests/windows-installer-diagnostics.ps1'), '-SignedCandidateAssetsDirectory', 'C:/nonexistent-diagnostic-fixture'], {
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'self-hosted' },
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Native acceptance host guard refused before mutation/);
  assert.doesNotMatch(result.stderr, /nonexistent-diagnostic-fixture/);
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
