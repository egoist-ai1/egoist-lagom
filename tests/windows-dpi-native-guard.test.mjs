import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { createDpiScope, compileDpiScope, assertDpiPreview, dpiPackets } from './windows-dpi-native-acceptance.mjs';

const root = path.resolve(import.meta.dirname, '..');
const helper = path.join(root, 'tests/windows-dpi-native-acceptance.mjs');
const script = path.join(root, 'tests/windows-dpi-native-acceptance.ps1');
const workDir = 'C:\\ProgramData\\EgoistShield\\Runtime\\Zapret';
const quoted = value => "'" + value.replaceAll("'", "''") + "'";
const scoped = compileDpiScope(createDpiScope(49191), workDir, root);

test('WindowsPS5 dot-source inputs retain BOM for non-ASCII source', () => {
  for (const file of [script, path.join(root, 'tests/windows-production-acceptance.ps1')]) {
    const bytes = fs.readFileSync(file);
    if (bytes.some(byte => byte >= 128)) assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], file);
  }
});

test('actual production compiler preserves the single held-port raw kernel scope', () => {
  assert.equal(scoped.argv.filter(argument => argument.startsWith('--wf-raw=')).length, 1);
  assert.equal(scoped.argv.find(argument => argument.startsWith('--wf-raw=')), '--wf-raw=' + scoped.kernel);
  assert.equal(scoped.argv.find(argument => argument.startsWith('--filter-tcp=')), '--filter-tcp=49191');
  assert.ok(!scoped.argv.some(argument => /--wf-udp|--wf-raw-part|--new|--hostlist|--filter-udp|@/.test(argument)));
  assert.equal(scoped.argv.filter(argument => argument.startsWith('--ipset-exclude=')).length, 2);
  assertDpiPreview('winws.exe ' + scoped.args, scoped, root);
});

test('production preview/runtime argv rejects broadening, injected flags and foreign executable', () => {
  const valid = 'winws.exe ' + scoped.args;
  for (const unsafe of [
    valid + ' --wf-udp=443', valid + ' --wf-raw=true', valid.replace('49191', '443'),
    valid.replace('!impostor', 'impostor'), valid + ' --wf-raw-part=@C:\\foreign-filter.txt',
    valid + ' --new --filter-tcp=443', 'cmd.exe /c ' + valid, valid + '\nsc.exe start foreign',
  ]) assert.throws(() => assertDpiPreview(unsafe, scoped, root));
  const expected = path.win32.join(workDir, 'core', 'bin', 'winws.exe');
  assertDpiPreview('"' + expected + '" ' + scoped.args, scoped, root, expected);
  assert.throws(() => assertDpiPreview('"C:\\foreign\\winws.exe" ' + scoped.args, scoped, root, expected));
});

test('scope rejects invalid ports; packet negatives include host-control traffic', () => {
  for (const port of [0, 443, 49151, 65536, 50000.5, NaN, '49191']) assert.throws(() => createDpiScope(port));
  assert.equal(createDpiScope(49152).port, 49152);
  assert.equal(createDpiScope(65535).port, 65535);
  const packets = dpiPackets(49191);
  assert.equal(packets.filter(item => item.expected).length, 2);
  for (const name of ['https-control', 'dns-control', 'physical-remote', 'different-local-address', 'impostor', 'ipv6'])
    assert.equal(packets.find(item => item.name === name).expected, false, name);
  // Input fixtures only. Native CI calls pinned real HelperEvalFilter;
  // no invented local predicate substitutes for real filter evaluation.
  assert.equal(Buffer.from(packets[0].packet, 'base64').readUInt16BE(22), 49191);
});

test('actual own fixture holds its port, verifies 20 nonces and retires after stdin closes', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, [helper, 'Fixture'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const input = createInterface({ input: child.stdout });
  const lines = input[Symbol.asyncIterator]();
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = async promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Owned fixture deadline')), 6000); timer.unref(); })]);
  try {
    const ready = JSON.parse((await deadline(lines.next())).value);
    assert.equal(ready.processId, child.pid);
    assert.ok(ready.port >= 49152 && ready.port <= 65535);
    for (let index = 0; index < 20; index++) {
      const nonce = randomBytes(24).toString('hex'), id = 'unit-' + index;
      child.stdin.write(JSON.stringify({ operation: 'probe', nonce, id }) + '\n');
      const reply = JSON.parse((await deadline(lines.next())).value);
      assert.deepEqual(reply, { id, ok: true, nonce, port: ready.port });
    }
    const net = await import('node:net');
    const competitor = net.createServer();
    const collision = await new Promise(resolve => { competitor.once('error', resolve); competitor.listen({ host: '127.0.0.1', port: ready.port, exclusive: true }, () => resolve(null)); });
    competitor.close();
    assert.equal(collision?.code, 'EADDRINUSE');
    child.stdin.end();
    assert.deepEqual(await deadline(exit), { code: 0, signal: null }, stderr);
  } finally {
    input.close();
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await deadline(exit); }
  }
});

const powershell = process.env.LAGOM_TEST_POWERSHELL7 || 'pwsh.exe';
const ownTemp = process.env.LAGOM_TEST_TEMP || path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'lagom-dpi-guard-' + process.pid);
function runPowerShell(code) {
  return execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], {
    cwd: root, windowsHide: true, timeout: 30000, encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', LAGOM_TEST_TEMP: ownTemp },
  });
}
test('PS7 C# compiles without DLL/driver open; owned child identity, deadline and retirement guards discriminate', { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  fs.mkdirSync(ownTemp, { recursive: true });
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    'Initialize-DpiNativeTypes',
    '$script:Work=' + quoted(ownTemp) + ';$env:GITHUB_WORKSPACE=' + quoted(root),
    '$script:DpiClock=[Diagnostics.Stopwatch]::StartNew();$script:DpiBudget=30',
    '$parentModulePath=$env:PSModulePath',
    '$parentPathExt=$env:PATHEXT',
    '$child=Start-DpiChild ' + quoted(process.execPath) + ' @(' + quoted(helper) + ",'Fixture') 'own guard fixture'",
    '$cases=@()',
    'try {',
    '$ready=Read-DpiLine $child 8',
    'if($ready.processId -ne $child.process.Id){throw "Own readiness identity mismatch"}',
    "if($child.process.StartInfo.Environment['PSModulePath'] -ine [IO.Path]::GetFullPath([IO.Path]::Combine([Environment]::GetFolderPath('Windows'),'System32/WindowsPowerShell/v1.0/Modules')) -or $env:PSModulePath -cne $parentModulePath){throw 'Actual generic child WindowsPS module isolation missing or parent changed'};$cases+='child-only-native-module-path'",
    "if($child.process.StartInfo.Environment['PATHEXT'] -cne '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC' -or $env:PATHEXT -cne $parentPathExt){throw 'Generic child PATHEXT missing or parent changed'};$cases+='child-only-native-extension-discovery'",
    '[void](Assert-DpiHeldProcess $child);$cases+="held-path-and-birth"',
    '$born=$child.birthTicks;$child.birthTicks--;$denied=$false;try{[void](Assert-DpiHeldProcess $child)}catch{$denied=$true};$child.birthTicks=$born;if(-not $denied){throw "Wrong birth admitted"};$cases+="wrong-birth-denied"',
    '$image=$child.executable;$child.executable="C:\\foreign\\node.exe";$denied=$false;try{[void](Assert-DpiHeldProcess $child)}catch{$denied=$true};$child.executable=$image;if(-not $denied){throw "Foreign image admitted"};$cases+="wrong-image-denied"',
    '$script:DpiBudget=0;$denied=$false;try{Assert-DpiDeadline}catch{$denied=$true};$script:DpiBudget=30;if(-not $denied){throw "Expired admission accepted"};$cases+="deadline-denied"',
    '}finally{Stop-DpiOwnedChild $child}',
    '$cases+="actual-owned-retirement"',
    "$script:InstallRoot=Join-Path $script:Work 'sealed-worker-fixture';$script:DataRoot=Join-Path $script:Work 'sealed-worker-data';$actorPath=Join-Path $script:InstallRoot 'resources/component-worker.cjs'",
    'New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($actorPath)) -Force | Out-Null',
    "[IO.File]::WriteAllText($actorPath,'process.stdout.write(JSON.stringify({processId:process.pid})+String.fromCharCode(10));process.stdin.resume();process.stdin.on(\"end\",()=>process.exit(0));')",
    '$worker=Start-DpiChild ' + quoted(process.execPath) + " @($actorPath) 'own sealed-env fixture' -Worker",
    'try{',
    '$ready=Read-DpiLine $worker 8;if($ready.processId -ne $worker.process.Id){throw "Own sealed fixture identity mismatch"}',
    "$actual=$worker.process.StartInfo.Environment;if($actual.ContainsKey('PSModulePath') -or $actual.Count -ne 8 -or $actual['ELECTRON_RUN_AS_NODE'] -cne '1' -or $actual['NODE_ENV'] -cne 'production' -or $worker.process.StartInfo.ArgumentList.Count -ne 1 -or $worker.process.StartInfo.ArgumentList[0] -ine $actorPath -or $env:PSModulePath -cne $parentModulePath){throw 'Sealed production Worker environment/argv changed'}",
    '$cases+="sealed-worker-environment-unchanged"',
    '}finally{Stop-DpiOwnedChild $worker}',
    '[ordered]@{ok=$true;nativeActions=0;cases=$cases;driverOpenInvoked=$false;dllLoaded=$false} | ConvertTo-Json -Compress',
  ].join('\n');
  const receipt = JSON.parse(runPowerShell(code).trim());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.nativeActions, 0);
  assert.equal(receipt.cases.length, 8);
});

test('actual readonly PS5 child reproduces executable pipeline refusal without startup PATHEXT', { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  const body = [
    "$ErrorActionPreference='Stop';$rows=@()",
    "foreach($leaf in @('whoami.exe','where.exe')){",
    "  $file=Join-Path ([Environment]::GetFolderPath('Windows')) ('System32/'+$leaf)",
    "  [string[]]$arguments=if($leaf -eq 'whoami.exe'){@('/user')}else{@('/Q','whoami.exe')}",
    '  try{$output=@(& $file @arguments 2>&1|ForEach-Object{"$_"});$rows+=@([ordered]@{leaf=$leaf;ok=$true;exitCode=$LASTEXITCODE})}',
    '  catch{$rows+=@([ordered]@{leaf=$leaf;ok=$false;errorId=$_.FullyQualifiedErrorId})}',
    '}',
    '[ordered]@{version=$PSVersionTable.PSVersion.Major;pathext=$env:PATHEXT;rows=$rows}|ConvertTo-Json -Depth 5 -Compress',
  ].join('\n');
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    'Initialize-DpiNativeTypes',
    '$script:Work=' + quoted(ownTemp) + ';$env:GITHUB_WORKSPACE=' + quoted(root),
    '$script:DpiClock=[Diagnostics.Stopwatch]::StartNew();$script:DpiBudget=30;$parentPathExt=$env:PATHEXT',
    "$ps5=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/WindowsPowerShell/v1.0/powershell.exe'",
    '$arguments=@("-NoLogo","-NoProfile","-NonInteractive","-OutputFormat","Text","-EncodedCommand",' + quoted(encoded) + ')',
    "$negativeEnvironment=${function:Set-NativeWindowsPowerShellChildEnvironment};function Set-NativeWindowsPowerShellChildEnvironment {param($StartInfo);& $negativeEnvironment -StartInfo $StartInfo;[void]$StartInfo.Environment.Remove('PATHEXT')}",
    "$negative=(Invoke-DpiTool $ps5 $arguments 'own-readonly-missing-PATHEXT' 10)|ConvertFrom-Json",
    'Set-Item -LiteralPath Function:Set-NativeWindowsPowerShellChildEnvironment -Value $negativeEnvironment',
    "$positive=(Invoke-DpiTool $ps5 $arguments 'own-readonly-canonical-PATHEXT' 10)|ConvertFrom-Json",
    "if(@($negative.rows|Where-Object{$_.ok -ne $false -or $_.errorId -cne 'CantActivateDocumentInPipeline'}).Count -ne 0){throw 'Missing startup PATHEXT did not reproduce exact document error'}",
    "if(@($positive.rows|Where-Object{$_.ok -ne $true -or $_.exitCode -ne 0}).Count -ne 0 -or $env:PATHEXT -cne $parentPathExt){throw 'Generic child executable recognition failed or parent env changed'}",
    '[ordered]@{ok=$true;negativeFailures=@($negative.rows).Count;positiveExits=@($positive.rows).Count;parentEnvPreserved=$true;nativeMutations=0}|ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, negativeFailures: 2, positiveExits: 2, parentEnvPreserved: true, nativeMutations: 0 });
});
test('native entry refuses unsupported environment before file/native action; pure supported-host contract is explicit', { skip: process.platform !== 'win32' }, () => {
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    "$environment=@{GITHUB_ACTIONS='true';CI='true';RUNNER_ENVIRONMENT='github-hosted';RUNNER_OS='Windows';GITHUB_REPOSITORY='egoist-ai1/egoist-lagom';GITHUB_RUN_ID='12';GITHUB_RUN_ATTEMPT='1';GITHUB_SHA=('a'*40)}",
    'if(@(Get-DpiEnvironmentErrors $environment $true $true 7 $true).Count){throw "Supported host contract rejected"}',
    '$environment.RUNNER_ENVIRONMENT="self-hosted";if(@(Get-DpiEnvironmentErrors $environment $true $true 7 $true).Count -ne 1){throw "Self-hosted admitted"}',
    'if(@(Get-DpiEnvironmentErrors $environment $false $true 5 $false).Count -lt 4){throw "Privilege/runtime guard missing"}',
    '$denied=$false;try{Invoke-DpiAcceptance}catch{if($_.Exception.Message -notmatch "host guard refused"){throw};$denied=$true}',
    'if(-not $denied){throw "Unsupported native entry accepted"}',
    '[ordered]@{ok=$true;nativeActions=0;fileMutations=0} | ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, nativeActions: 0, fileMutations: 0 });
});

test('actual finally preserves Setup failure and collects installer diagnostics plus readonly final state', { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    '$script:Work=Join-Path ' + quoted(ownTemp) + " 'failed-install-finally';$script:DataRoot=Join-Path $script:Work 'data';$script:Evidence=Join-Path $script:Work 'evidence'",
    "New-Item -ItemType Directory -Path $script:Work,$script:Evidence,(Join-Path $script:DataRoot 'installer'),(Join-Path $script:DataRoot 'Service') -Force | Out-Null",
    "[IO.File]::WriteAllText((Join-Path $script:DataRoot 'installer/upgrade-journal.json'),'{\"phase\":\"PreInstall\",\"stage\":\"phase-failed\",\"exitCode\":54}')",
    "[IO.File]::WriteAllText((Join-Path $script:DataRoot 'Service/service.log'),'own Core diagnostic fixture')",
    "$script:DpiReceiptPath=Join-Path $script:Work 'windows-dpi-native-acceptance.json';$script:InstallRoot=Join-Path $script:Work 'partial';$script:Core=Join-Path $script:InstallRoot 'resources/core-service/win-x64/EgoistShield.Service.exe'",
    "$script:DpiReceipt=[ordered]@{beforeNetwork=[ordered]@{dns=@('own-baseline')};nativeActions=1;completedPairs=0;observedDriverOpen=0;observedDriverClose=0;actualRemoveCompleted=$false;actualUninstallCompleted=$false;actualCleanInstallCompleted=$false;emergencyCleanupErrors=@();boundaries=[ordered]@{corePublicIdentitySnapshot=$false};result='failed'}",
    "$script:DpiWorker=$null;$script:DpiFixture=$null;$script:DpiFilter=$null;$script:DpiSeals=@();$script:DpiClock=[Diagnostics.Stopwatch]::StartNew();$script:DpiBudget=2160;$script:FinalReadbackCalls=@()",
    'function Invoke-DpiTool { param($Executable,$Arguments,$Label,$Seconds,$InputText)',
    "  if($Label -notmatch '^final-readonly-'){throw ('Unexpected actor/mutation: '+$Label)}",
    '  $encoded=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Arguments[-1]))',
    "  if($encoded -match '(?:start|stop|install|remove)Service|Reset-|Set-Dns|sc\.exe|--winws-process-snapshot'){throw 'Mutating or unverified Core command in readback'}",
    "  $expected=@{'final-readonly-services'='Get-NativeProductServices';'final-readonly-tasks'='Get-NativeProductTasks';'final-readonly-drivers'='Get-DpiDrivers';'final-readonly-winws'='Get-DpiGlobalWinws';'final-readonly-network'='Get-NativeNetworkFingerprint'}",
    "  if(-not $encoded.Contains($expected[$Label]) -or $Executable -ine (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/WindowsPowerShell/v1.0/powershell.exe')){throw 'Actual readonly source/controller or PS5 path changed'}",
    "  foreach($stage in @('process-start','library-ready','query-ready','serialized')){if(-not $encoded.Contains('|'+$stage+'|')){throw 'Readonly query stage marker missing'}}",
    '  $script:FinalReadbackCalls+=@([ordered]@{label=$Label;seconds=$Seconds;executable=$Executable;code=$encoded})',
    '  switch($Label){',
    "    'final-readonly-services' {return ([ordered]@{schemaVersion=1;kind='readonly-final-state';name='services';value=@([ordered]@{Name='EgoistShieldCore';State='Running';StartMode='Auto';StartName='LocalSystem';PathName=$script:Core;ProcessId=1544})}|ConvertTo-Json -Depth 6 -Compress)}",
    "    'final-readonly-network' {return ([ordered]@{schemaVersion=1;kind='readonly-final-state';name='network';value=[ordered]@{dns=@('own-baseline')}}|ConvertTo-Json -Compress)}",
    "    default {return ([ordered]@{schemaVersion=1;kind='readonly-final-state';name=$Label.Substring('final-readonly-'.Length);value=@()}|ConvertTo-Json -Compress)}",
    '  }',
    '}',
    "function Stop-DpiOwnedChild {param($Owner);if($Owner){throw 'Unexpected live child'}};function Invoke-DpiEmergencyStop {throw 'Unexpected broad repair'};function Get-DpiDrivers {throw 'Unbounded OS query escaped readback'}",
    "$installed=$false;$on=$null;$xmlSeal=$null;$productSeals=@();$retirementErrors=@();$acceptanceProfile=Join-Path $script:Work 'own-acceptance.profile';$installerLease=[pscustomobject]@{stream=[IO.MemoryStream]::new()};$manifestLease=[pscustomobject]@{stream=[IO.MemoryStream]::new()}",
    "try{throw 'Child failed (41): actual-clean-candidate-install; '}catch{$primaryError=$_};$script:DpiReceipt.error=$primaryError.Exception.Message",
    '$tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(' + quoted(script) + ',[ref]$tokens,[ref]$parseErrors)',
    "if($parseErrors.Count){throw 'DPI parse error'}",
    "$entry=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-DpiAcceptance'},$false)",
    "$try=$entry.Body.Find({param($node) $node -is [Management.Automation.Language.TryStatementAst] -and $node.Finally -and $node.Finally.Extent.Text -match '[$]installed -and'},$true)",
    'if(-not $try){throw "Actual acceptance finally missing"};$body=$try.Finally.Extent.Text;. ([scriptblock]::Create($body.Substring(1,$body.Length-2)))',
    "$saved=Get-Content -LiteralPath $script:DpiReceiptPath -Raw|ConvertFrom-Json;if($saved.error -cne 'Child failed (41): actual-clean-candidate-install; ' -or $saved.result -cne 'failed' -or $saved.nativeActions -ne 1){throw 'Primary failure/admission count changed'}",
    "if($saved.finalStateReadbacks.services.status -cne 'observed' -or $saved.finalStateReadbacks.core.status -cne 'present' -or $saved.finalStateReadbacks.network.preserved -ne $true){throw 'Final SCM/Core/network readbacks missing'}",
    "if($saved.boundaries.corePublicIdentitySnapshot -ne $false){throw 'SCM metadata counted as public Core identity coverage'}",
    "if($script:FinalReadbackCalls.Count -ne 5 -or @($script:FinalReadbackCalls|Where-Object{$_.seconds -gt 70}).Count){throw 'Independent readbacks/bounds changed'}",
    "if(@($saved.installerDiagnosticsReadbacks).Count -ne 2){throw 'Before/after diagnostics missing'}",
    "foreach($stage in @('before-retirement','after-retirement')){$journal=Join-Path $script:Evidence ($stage+'.installer-upgrade-journal.jsonl');if(-not [IO.File]::Exists($journal) -or [IO.File]::ReadAllText($journal) -notmatch 'PreInstall'){throw 'Phase diagnostic not exported'}}",
    '[ordered]@{ok=$true;nativeActions=1;readbacks=$script:FinalReadbackCalls.Count;primaryErrorPreserved=$true;liveNativeQueries=0}|ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, nativeActions: 1, readbacks: 5, primaryErrorPreserved: true, liveNativeQueries: 0 });
});

test('final readbacks distinguish unavailable from absent and continue after independent failures', { skip: process.platform !== 'win32' }, () => {
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    "$script:DpiReceipt=[ordered]@{beforeNetwork=[ordered]@{dns=@('before')};boundaries=[ordered]@{corePublicIdentitySnapshot=$false};nativeActions=0};$script:Core='C:\\own-fixture\\Core.exe';$script:Readbacks=@()",
    'function Invoke-DpiTool {param($Executable,$Arguments,$Label,$Seconds,$InputText);$script:Readbacks+=$Label;',
    "if($Label -in @('final-readonly-services','final-readonly-network')){throw ('own unavailable '+$Label)};return ([ordered]@{schemaVersion=1;kind='readonly-final-state';name=$Label.Substring('final-readonly-'.Length);value=@()}|ConvertTo-Json -Compress)}",
    '$failures=@(Save-DpiFinalStateReadbacks)',
    "if($script:Readbacks.Count -ne 5 -or $failures.Count -ne 2){throw 'Independent readback failed to continue'}",
    "$state=$script:DpiReceipt.finalStateReadbacks;if($state.services.status -cne 'unavailable' -or $state.core.status -cne 'unknown' -or $state.network.status -cne 'unavailable' -or $state.drivers.status -cne 'observed' -or @($state.drivers.value).Count -ne 0){throw 'Unavailable confused with absent'}",
    'if($script:DpiReceipt.nativeActions -ne 0 -or $script:DpiReceipt.boundaries.corePublicIdentitySnapshot -ne $false){throw "Readback claimed actor coverage or native mutation"}',
    '[ordered]@{ok=$true;readbacks=$script:Readbacks.Count;unavailable=$failures.Count;nativeActions=0}|ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, readbacks: 5, unavailable: 2, nativeActions: 0 });
});

test('readonly deadline survives forced owned retirement and exports bounded stage evidence', { skip: process.platform !== 'win32', timeout: 40000 }, () => {
  const code = [
    "$ErrorActionPreference='Stop'",
    '. ' + quoted(script) + ' -LibraryOnly',
    'Initialize-DpiNativeTypes',
    '$script:Work=Join-Path ' + quoted(ownTemp) + " 'readonly-timeout';$env:GITHUB_WORKSPACE=" + quoted(root),
    'New-Item -ItemType Directory -Path $script:Work -Force|Out-Null',
    "$fixture=Join-Path $script:Work 'own-readonly-hang.cjs'",
    "[IO.File]::WriteAllText($fixture,'process.stderr.write(\"readonly-stage|drivers|process-start|0\\n\"+String.fromCharCode(233).repeat(100000));process.stdout.write(String.fromCodePoint(0x1f642).repeat(300000));process.stdin.resume();setInterval(()=>{},1000);')",
    '$script:DpiClock=[Diagnostics.Stopwatch]::StartNew();$script:DpiBudget=30;$script:DpiReceipt=[ordered]@{nativeActions=0}',
    '$caught=$null;try{[void](Invoke-DpiTool ' + quoted(process.execPath) + " @($fixture) 'final-readonly-drivers' 2)}catch{$caught=$_}",
    "if(-not $caught -or $caught.Exception.Message -cne 'Bounded child operation timed out: final-readonly-drivers' -or $caught.Exception.Data['ownedRetirementDiagnostic'] -notmatch 'Forced owned child retirement' -or $caught.Exception.Data['ownedRetirementConfirmed'] -ne $false){throw 'First deadline masked by child retirement'}",
    "$observation=Get-Content -LiteralPath (Join-Path $script:Work 'final-readonly-drivers.observation.json') -Raw|ConvertFrom-Json",
    "if($observation.retirementConfirmed -ne $false -or $observation.primaryError -cne $caught.Exception.Message -or $observation.stages.Count -ne 1 -or $observation.stderr.status -cne 'captured' -or $observation.stderr.truncated -ne $true -or $observation.stdout.truncated -ne $true -or (Get-Item -LiteralPath (Join-Path $script:Work $observation.stderr.file)).Length -gt 65536 -or (Get-Item -LiteralPath (Join-Path $script:Work $observation.stdout.file)).Length -gt 1048576 -or $observation.processId -le 0 -or $observation.birthTicks -le 0){throw 'Bounded correlated unavailable-state evidence missing'}",
    'if($script:DpiReceipt.nativeActions -ne 0 -or @($script:DpiReceipt.readonlyToolObservations).Count -ne 1){throw "Readback diagnostic counted as mutation or was not retained"}',
    '[ordered]@{ok=$true;primaryDeadlinePreserved=$true;retirementConfirmed=$false;stages=1;nativeMutations=0}|ConvertTo-Json -Compress',
  ].join('\n');
  assert.deepEqual(JSON.parse(runPowerShell(code).trim()), { ok: true, primaryDeadlinePreserved: true, retirementConfirmed: false, stages: 1, nativeMutations: 0 });
});
