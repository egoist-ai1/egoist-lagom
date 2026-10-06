import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const enabled = process.platform === 'win32' && !!process.env.LAGOM_TEST_TEMP;
const quote = value => value.replaceAll("'", "''");
const shell = process.env.LAGOM_WINDOWS_POWERSHELL || path.join(process.env.SystemRoot || '', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const source = path.resolve('tests/windows-production-acceptance.ps1');
const helperSources = [
  ['invoke-final-silent-reinstall.ps1', 'scripts/invoke-final-silent-reinstall.ps1'],
  ['service-maintenance.ps1', 'src/installer/service-maintenance.ps1'],
  ['maintenance-boot-recovery.ps1', 'src/installer/maintenance-boot-recovery.ps1'],
  ['gui-login-startup.ps1', 'src/installer/gui-login-startup.ps1'],
];
async function fixture() {
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'protected-route-'));
  const payload = [];
  for (const [name, file] of helperSources) {
    let bytes = await fs.readFile(file);
    if (!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
    payload.push({ path: `resources/installer/${name}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ payload }));
  return directory;
}
function execute(directory, body) {
  const prefix = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);. '${quote(source)}' -LibraryOnly;$directory='${quote(directory)}';$fixtureManifest=Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw|ConvertFrom-Json;`;
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefix + body, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, PSModulePath: path.basename(shell).toLowerCase() === 'powershell.exe' ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') : path.join(path.dirname(shell), 'Modules') } });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  return JSON.parse(child.stdout);
}
async function clean(directory) {
  assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
  await fs.rm(directory, { recursive: true, force: true });
}

test('current production installer helpers are bound to four exact candidate payload byte inventories', { skip: !enabled }, async () => {
  const directory = await fixture();
  try {
    const result = execute(directory, `
      $sourceRoot='${quote(process.cwd())}';
      $destination=Join-Path $directory 'verified';
      $proof=Initialize-NativeCandidateInstallerHelpers -Manifest $fixtureManifest -SourceRoot $sourceRoot -Destination $destination;
      if(-not $proof.immutablePayloadMatched -or @($proof.inventory).Count -ne 4){throw 'Four-file verification failed'};
      foreach($entry in $proof.inventory){if((Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ine $entry.sha256){throw 'Written bytes changed'};$bom=[IO.File]::ReadAllBytes($entry.path);if($bom[0] -ne 0xef -or $bom[1] -ne 0xbb -or $bom[2] -ne 0xbf){throw 'Packaged BOM lost'}};
      $refused=0;
      foreach($fault in @('sha','bytes','duplicate','missing','foreign')){
        $bad=($fixtureManifest|ConvertTo-Json -Depth 8)|ConvertFrom-Json;
        switch($fault){'sha'{$bad.payload[0].sha256='f'*64};'bytes'{$bad.payload[0].bytes++};'duplicate'{$bad.payload+=@($bad.payload[0])};'missing'{$bad.payload=@($bad.payload|Select-Object -Skip 1)};'foreign'{$bad.payload[0].path='resources/installer/foreign.ps1'}};
        $target=Join-Path $directory $fault;$rejected=$false;
        try{Initialize-NativeCandidateInstallerHelpers -Manifest $bad -SourceRoot $sourceRoot -Destination $target|Out-Null}catch{$rejected=$true};
        if(-not $rejected -or (Test-Path -LiteralPath $target)){throw 'Bad inventory wrote executable helpers before refusal'};$refused++;
      };
      $existing=$false;try{Initialize-NativeCandidateInstallerHelpers -Manifest $fixtureManifest -SourceRoot $sourceRoot -Destination $destination|Out-Null}catch{$existing=$true};if(-not $existing){throw 'Existing helper stage was reused'};
      @{verifiedFiles=4;inventoryFaultsRefusedBeforeWrite=$refused;existingStageRefused=$existing;nativeServiceMutations=0}|ConvertTo-Json -Compress
    `);
    assert.deepEqual(result, { verifiedFiles: 4, inventoryFaultsRefusedBeforeWrite: 5, existingStageRefused: true, nativeServiceMutations: 0 });
  } finally { await clean(directory); }
});

test('protected completion rejects dispatched-only, failed, recovered, mismatched and nonzero installer receipts', { skip: !enabled }, async () => {
  const directory = await fixture();
  try {
    const result = execute(directory, `
      $run='a'*32;$valid=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';runId=$run;events=@([pscustomobject]@{stage='installer';status='installer-exited';data=[pscustomobject]@{exitCode=0}},[pscustomobject]@{stage='verify';status='succeeded'})};
      Assert-NativeProtectedCompletion -Receipt $valid -RunId $run -Flag 'success';$refused=0;
      foreach($fault in @('flag','owner','run','version','dispatch','duplicate','exit','string-exit','worker-failed','recovery-pending','recovered')){
        $bad=($valid|ConvertTo-Json -Depth 8)|ConvertFrom-Json;$flag='success';
        switch($fault){'flag'{$flag='worker-failed'};'owner'{$bad.owner='Foreign'};'run'{$bad.runId='b'*32};'version'{$bad.schemaVersion=2};'dispatch'{$bad.events=@([pscustomobject]@{stage='dispatch';status='dispatched'})};'duplicate'{$bad.events+=@($bad.events[1])};'exit'{$bad.events[0].data.exitCode=54};'string-exit'{$bad.events[0].data.exitCode='0'};default{$bad.events+=@([pscustomobject]@{stage='worker';status=$(if($fault -eq 'worker-failed'){'failed'}else{$fault})})}};
        $rejected=$false;try{Assert-NativeProtectedCompletion -Receipt $bad -RunId $run -Flag $flag}catch{$rejected=$true};if(-not $rejected){throw ('Invalid completion accepted: '+$fault)};$refused++;
      };
      @{validCompletion=$true;invalidReceiptsRefused=$refused;nativeCalls=0}|ConvertTo-Json -Compress
    `);
    assert.deepEqual(result, { validCompletion: true, invalidReceiptsRefused: 11, nativeCalls: 0 });
  } finally { await clean(directory); }
});

test('baseline upgrade uses the verified current protected worker and keeps failure evidence through real harness flow', { skip: !enabled }, async () => {
  const directory = await fixture();
  try {
    const result = execute(directory, `
      $script:CandidateManifest=$fixtureManifest;$script:Version='3.8.1';$script:NativePowerShell='${quote(shell)}';
      $script:Installer=Join-Path $directory 'EgoistShield-Setup-3.8.1.exe';[IO.File]::WriteAllText($script:Installer,'synthetic setup');$script:InstallerHash=(Get-FileHash -LiteralPath $script:Installer -Algorithm SHA256).Hash;$script:ManifestPath=Join-Path $directory 'manifest.json';$script:InstallRoot=Join-Path $directory 'fictional-install';
      function Assert-NativeAdministratorOwned {param($Path)return @{path=$Path;controlledAclBoundary=$true}};
      function Assert-NativeBootTask {param($Stage)return @{stage=$Stage;controlledTaskBoundary=$true}};
      function Get-ScheduledTask {param($TaskName,$TaskPath,$ErrorAction)$script:TaskReads++;if($script:Fault -ne 'no-task' -and $script:TaskReads -eq 1){return @{TaskName=$TaskName}}};
      function Wait-NativeCondition {param($Condition,$Label,$TimeoutSeconds)if(-not (& $Condition)){throw 'Task still registered'}};
      function Invoke-NativeBounded {
        param($Executable,$Arguments,$Label,$TimeoutSeconds)
        if($Executable -cne $script:NativePowerShell -or $Arguments -contains '/S' -or $Arguments -notcontains '-NoRunAfter' -or $Arguments -notcontains '-FromVersion' -or $Arguments -notcontains '3.8.0'){throw 'Unsafe ordinary Setup path selected'};
        $index=[Array]::IndexOf($Arguments,'-File');$current=$Arguments[$index+1];if($current -ine (Join-Path $script:Work 'candidate-installer-helpers\\invoke-final-silent-reinstall.ps1')){throw 'Old or unverified helper selected'};
        $script:Dispatches++;$id='a'*32;$stage=Join-Path $script:DeferredRoot $id;New-Item -ItemType Directory -Path $stage|Out-Null;
        $events=@(@{stage='installer';status='installer-exited';data=@{exitCode=0}},@{stage='verify';status='succeeded'});if($script:Fault -eq 'worker-failed'){$events+=@{stage='worker';status='failed'}};
        @{schemaVersion=1;owner='EgoistShield';runId=$id;events=$events}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $stage 'receipt.json') -Encoding utf8;
        [IO.File]::WriteAllText((Join-Path $stage 'complete.flag'),'success');foreach($item in Get-ChildItem -LiteralPath (Split-Path -Parent $current) -File){Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $stage $item.Name)};Copy-Item -LiteralPath $script:Installer -Destination (Join-Path $stage 'EgoistShield-Setup-3.8.1.exe');Copy-Item -LiteralPath $script:ManifestPath -Destination (Join-Path $stage 'package-integrity.json');@{schemaVersion=1;owner='EgoistShield';version=$script:Version;sha256=$script:InstallerHash;bytes=(Get-Item -LiteralPath $script:Installer).Length;runAfter=$false;sourceInstaller=$script:Installer;installer=(Join-Path $stage 'EgoistShield-Setup-3.8.1.exe');manifest=(Join-Path $stage 'package-integrity.json')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $stage 'state.json') -Encoding utf8;[IO.File]::WriteAllText((Join-Path $stage 'worker.stderr.log'),'synthetic retained failure');
        if($script:Fault -eq 'tampered-helper'){[IO.File]::AppendAllText((Join-Path $stage 'service-maintenance.ps1'),'tamper')};if($script:Fault -eq 'wrong-stage-installer'){[IO.File]::AppendAllText((Join-Path $stage 'EgoistShield-Setup-3.8.1.exe'),'tamper')};
        return @{stdout=(@{dispatched=$true;runId=$id;state=(Join-Path $stage 'state.json');receipt=$(if($script:Fault -eq 'escaped'){Join-Path $directory 'foreign.json'}else{Join-Path $stage 'receipt.json'})}|ConvertTo-Json -Compress);elapsedMilliseconds=1}
      };
      $passed=0;$refused=0;$script:Dispatches=0;
      foreach($fault in @('valid','worker-failed','no-task','escaped','tampered-helper','wrong-stage-installer')){
        $script:Fault=$fault;$script:TaskReads=0;$script:Work=Join-Path $directory $fault;New-Item -ItemType Directory -Path $script:Work|Out-Null;$script:DataRoot=Join-Path $script:Work 'data';$script:DeferredRoot=Join-Path $script:Work 'deferred';New-Item -ItemType Directory -Path $script:DeferredRoot|Out-Null;
        $script:ReceiptPath=Join-Path $script:Work 'harness.json';$script:Receipt=[ordered]@{mutations=@()};$result=$null;$rejected=$false;
        try{$result=Invoke-NativeProtectedReinstall -Operation 'upgrade-3.8.0'}catch{if($fault -eq 'valid'){throw};$rejected=$true};
        if($fault -eq 'valid'){if($rejected -or -not $result.completed -or -not $result.taskRemoved -or $script:Receipt.Contains('reinstall')){throw 'Valid baseline handoff not proven separately'};$passed++}
        else{if(-not $rejected -or ($script:Receipt.Contains('protectedUpgrade') -and $script:Receipt.protectedUpgrade.completed)){throw 'Failed baseline handoff reported completion'};$refused++;if($fault -ne 'escaped' -and -not(Test-Path -LiteralPath (Join-Path $script:Work 'protected-upgrade-worker.stderr.log'))){throw 'Failure diagnostics lost'}};
      };
      @{validRoute=$passed;invalidRoutesRefused=$refused;protectedDispatches=$script:Dispatches;actualSetupRuns=0;actualServiceCalls=0;actualTaskCalls=0}|ConvertTo-Json -Compress
    `);
    assert.deepEqual(result, { validRoute: 1, invalidRoutesRefused: 5, protectedDispatches: 6, actualSetupRuns: 0, actualServiceCalls: 0, actualTaskCalls: 0 });
  } finally { await clean(directory); }
});
