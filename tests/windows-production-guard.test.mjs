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

test('native GUI PE contract requires administrator for GUI and retains asInvoker for SYSTEM worker', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''");
  const body = "$ErrorActionPreference='Stop';. '" + source + "' -LibraryOnly;" +
    "Assert-NativeGuiExecutionLevel -Role 'gui' -Level 'requireAdministrator';" +
    "Assert-NativeGuiExecutionLevel -Role 'worker' -Level 'asInvoker';" +
    "$refused=0;foreach($case in @(@{role='gui';level='asInvoker'},@{role='worker';level='requireAdministrator'},@{role='gui';level='highestAvailable'},@{role='gui';level=''})){" +
    "try{Assert-NativeGuiExecutionLevel -Role $case.role -Level $case.level;throw 'Bad manifest accepted'}catch{if($_.Exception.Message -eq 'Bad manifest accepted'){throw};$refused++}};" +
    "@{refused=$refused;physicalMutations=0}|ConvertTo-Json -Compress";
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { refused: 4, physicalMutations: 0 });
});

test('native elevated token proof refuses medium, disabled administrator, wrong SID/session and malformed evidence', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''");
  const body = "$ErrorActionPreference='Stop';. '" + source + "' -LibraryOnly;" +
    "$valid=@{userSid='S-1-5-21-100-200-300-1001';elevated=$true;administratorsEnabled=$true;integrityRid=12288;sessionId=7;uiAccess=$false;tokenType=1};" +
    "$runner=$valid.Clone();Assert-NativeElevatedGuiTokenProof -Token $valid -RunnerToken $runner;" +
    "$cases=@(@{name='elevated';value=$false},@{name='elevated';value='true'},@{name='administratorsEnabled';value=$false}," +
    "@{name='integrityRid';value=8192},@{name='integrityRid';value='12288'},@{name='sessionId';value=8}," +
    "@{name='userSid';value='S-1-5-21-100-200-300-1002'},@{name='userSid';value='S-1-5-18'}," +
    "@{name='uiAccess';value=$true},@{name='uiAccess';value='false'},@{name='tokenType';value=2},@{name='tokenType';value='1'});$refused=0;" +
    "foreach($case in $cases){$bad=$valid.Clone();$bad[$case.name]=$case.value;" +
    "try{Assert-NativeElevatedGuiTokenProof -Token $bad -RunnerToken $runner;throw 'Bad token accepted'}catch{if($_.Exception.Message -eq 'Bad token accepted'){throw};$refused++}};" +
    "foreach($name in @($valid.Keys)){$bad=$valid.Clone();$bad.Remove($name);" +
    "try{Assert-NativeElevatedGuiTokenProof -Token $bad -RunnerToken $runner;throw 'Missing token field accepted'}catch{if($_.Exception.Message -eq 'Missing token field accepted'){throw};$refused++}};" +
    "$badRunner=$runner.Clone();$badRunner.elevated=$false;" +
    "try{Assert-NativeElevatedGuiTokenProof -Token $valid -RunnerToken $badRunner;throw 'Unelevated runner accepted'}catch{if($_.Exception.Message -eq 'Unelevated runner accepted'){throw};$refused++};" +
    "@{accepted=$true;refused=$refused;physicalMutations=0}|ConvertTo-Json -Compress";
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { accepted: true, refused: 20, physicalMutations: 0 });
});

test('native production launch uses explicit elevated lease, real SCM stop/start and SYSTEM worker evidence', async () => {
  const source = await fs.readFile(path.resolve('tests/windows-production-acceptance.ps1'), 'utf8');
  const start = source.indexOf('function Invoke-NativeElevatedGui {');
  const end = source.indexOf('function Assert-NativePrivateState {', start);
  assert.ok(start >= 0 && end > start);
  const flow = source.slice(start, end);
  assert.match(flow, /Start-ElevatedGuiLease -CanonicalInstalledGuiPath/);
  assert.match(flow, /Stop-ElevatedGuiLease -Lease/);
  assert.doesNotMatch(flow, /Start-OrdinaryGuiLease|CreateRestrictedToken|manualLUA|no-sandbox|disable-gpu/);
  assert.match(flow, /Assert-NativeElevatedGuiTokenProof -Token \$proof.token -RunnerToken \$proof.runnerToken/);
  assert.match(flow, /Get-NativeProcessIdentity \$child.Id/);
  assert.match(flow, /Real SCM Telegram stop through elevated GUI\/Core IPC/);
  assert.match(flow, /Real SCM Telegram start through elevated GUI\/Core IPC/);
  assert.match(flow, /S-1-5-18/);
  assert.match(flow, /WaitForExit\(30000\)/);
  assert.match(flow, /WindowPattern/);
  assert.match(flow, /\$script:Receipt.elevatedGui=/);
  assert.match(flow, /GUI IPC from an actual elevated Windows user token/);
  assert.doesNotMatch(source, /Invoke-NativeOrdinaryGui|actual-nonadministrator-gui-core-broker|Receipt\.ordinaryGui=/);
  assert.match(source, /actual-native-elevated-gui-windows-doh/);
  assert.doesNotMatch(source, /actual-native-ordinary-gui-windows-doh|GUI IPC from an actual standard Windows user token/);
});

test('native network gate binds each elevated launch to the same operation, process birth and zero-orphan cleanup', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve('tests/windows-production-acceptance.ps1').replaceAll("'", "''");
  const token = { userSid: 'S-1-5-21-100-200-300-1001', elevated: true, administratorsEnabled: true,
    integrityRid: 12288, sessionId: 7, uiAccess: false, tokenType: 1 };
  const commit = 'a'.repeat(40), hash = 'b'.repeat(64);
  const executable = 'C:\\Program Files\\EgoistShield\\EgoistShield.exe';
  const entries = ['Apply', 'Reset'].flatMap((operation, index) => {
    const proof = { launchPolicy: 'elevated', elevatedGui: true, guiRequestedExecutionLevel: 'requireAdministrator',
      token, runnerToken: token, executable, arguments: [], source: { commit, version: '3.8.0', integrityManifestSha256: hash },
      artifactSourceCommit: commit, harnessSourceCommit: commit, processId: 123 + index,
      startTimeUtc: '2026-10-01T12:00:0' + index + '.0000000Z' };
    return [{ operation, launch: proof }, { operation, cleanup: {
      launch: proof, stage: 'completed', exitedNormally: true, exitCode: 0,
      cleanup: { noOrphans: true, activeProcesses: 0 },
    } }];
  });
  const fixture = JSON.stringify({ candidateVersion: '3.8.0', gui: entries }).replaceAll("'", "''");
  const body = "$ErrorActionPreference='Stop';. '" + source + "' -LibraryOnly;" +
    "$json='" + fixture + "';function Fresh {ConvertFrom-Json -InputObject $json -DateKind String};" +
    "$valid=Fresh;Assert-NativeNetworkGuiReceipts -Receipt $valid -SourceCommit '" + commit +
    "' -InstalledGuiPath '" + executable + "' -ExpectedIntegritySha256 '" + hash + "';" +
    "$cases=@('medium','disabled-admin','wrong-source','wrong-exe','extra-arg','false-manifest','false-integrity','cleanup-operation'," +
    "'cleanup-pid','cleanup-birth','cleanup-stage','cleanup-exit','cleanup-not-normal','cleanup-orphan','cleanup-active','missing-close','duplicate-operation');$refused=0;" +
    "foreach($case in $cases){$bad=Fresh;switch($case){" +
    "'medium'{$bad.gui[0].launch.token.integrityRid=8192}" +
    "'disabled-admin'{$bad.gui[0].launch.token.administratorsEnabled=$false}" +
    "'wrong-source'{$bad.gui[0].launch.source.commit=('c'*40)}" +
    "'wrong-exe'{$bad.gui[0].launch.executable='C:\\foreign.exe'}" +
    "'extra-arg'{$bad.gui[0].launch.arguments=@('--no-sandbox')}" +
    "'false-manifest'{$bad.gui[0].launch.guiRequestedExecutionLevel='asInvoker'}" +
    "'false-integrity'{$bad.gui[0].launch.source.integrityManifestSha256=('c'*64)}" +
    "'cleanup-operation'{$bad.gui[1].operation='Other'}" +
    "'cleanup-pid'{$bad.gui[1].cleanup.launch.processId=999}" +
    "'cleanup-birth'{$bad.gui[1].cleanup.launch.startTimeUtc='2026-10-01T12:00:09Z'}" +
    "'cleanup-stage'{$bad.gui[1].cleanup.stage='failed'}" +
    "'cleanup-exit'{$bad.gui[1].cleanup.exitCode=49}" +
    "'cleanup-not-normal'{$bad.gui[1].cleanup.exitedNormally=$false}" +
    "'cleanup-orphan'{$bad.gui[1].cleanup.cleanup.noOrphans=$false}" +
    "'cleanup-active'{$bad.gui[1].cleanup.cleanup.activeProcesses=1}" +
    "'missing-close'{$bad.gui=@($bad.gui[0],$bad.gui[2],$bad.gui[3])}" +
    "'duplicate-operation'{$bad.gui[2].operation='Apply';$bad.gui[3].operation='Apply'}};" +
    "try{Assert-NativeNetworkGuiReceipts -Receipt $bad -SourceCommit '" + commit +
    "' -InstalledGuiPath '" + executable + "' -ExpectedIntegritySha256 '" + hash +
    "';throw ('Invalid pair accepted: '+$case)}catch{if($_.Exception.Message -like 'Invalid pair accepted:*'){throw};$refused++}};" +
    "@{accepted=$true;refused=$refused;physicalMutations=0}|ConvertTo-Json -Compress";
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { accepted: true, refused: 17, physicalMutations: 0 });
});

test('native GUI startup XML rejects foreign identity, reduced rights, timeout, executable and extra actions', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const quote = value => value.replaceAll("'", "''");
  const source = quote(path.resolve('tests/windows-production-acceptance.ps1'));
  const helper = quote(path.resolve('src/installer/gui-login-startup.ps1'));
  const body = "$ErrorActionPreference='Stop';. '" + source + "' -LibraryOnly;. '" + helper + "';" +
    "$script:InstallRoot='C:\\Program Files\\EgoistShield';$sid='S-1-5-21-100-200-300-1001';" +
    "$context=@{sid=$sid;exe=(Join-Path $script:InstallRoot 'EgoistShield.exe');root=$script:InstallRoot};" +
    "$state=@{owner='EgoistShield';purpose='gui-login-startup';userSid=$sid;taskName=('EgoistLagom-GuiAutostart-'+$sid);taskPath=('\\EgoistLagom-GuiAutostart-'+$sid)};" +
    "$saved=@{registrationId=('a'*32)};$good=New-GuiStartupTaskXml -Context $context -Receipt $saved -TaskEnabled $true;" +
    "$proof=Assert-NativeGuiStartupTaskXml -XmlText $good -State $state -ExpectedEnabled $true;" +
    "$norm=$good.Replace(('egoistshield:gui-login-startup:v1:'+$sid+':'+('a'*32)),$state.taskPath).Replace('<Enabled>true</Enabled>','').Replace('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>','');" +
    "$normalized=Assert-NativeGuiStartupTaskXml -XmlText $norm -State $state -ExpectedEnabled $true;if($normalized.registrationId -cne ('a'*32) -or $normalized.uri -cne $state.taskPath){throw 'Normalized proof lost protected nonce/path'};" +
    "$disabled=New-GuiStartupTaskXml -Context $context -Receipt $saved -TaskEnabled $false;" +
    "[void](Assert-NativeGuiStartupTaskXml -XmlText $disabled -State $state -ExpectedEnabled $false);" +
    "$cases=@(@{from='HighestAvailable';to='LeastPrivilege'},@{from='InteractiveToken';to='ServiceAccount'}," +
    "@{from='PT0S';to='PT72H'},@{from='IgnoreNew';to='Parallel'},@{from='<AllowStartOnDemand>false</AllowStartOnDemand>';to='<AllowStartOnDemand>true</AllowStartOnDemand>'}," +
    "@{from='--background --minimized';to='--no-sandbox'},@{from='EgoistShield.exe';to='foreign.exe'}," +
    "@{from='<Author>EgoistShield</Author>';to='<Author>Foreign</Author>'},@{from=($sid+':'+('a'*32));to=($sid+':bad')}," +
    "@{from='</Exec>';to='</Exec><Exec><Command>foreign.exe</Command></Exec>'},@{from='<UserId>'+ $sid +'</UserId>';to='<UserId>S-1-5-18</UserId>'});$refused=0;" +
    "foreach($case in $cases){$bad=$good.Replace($case.from,$case.to);if($bad -ceq $good){throw 'Fixture transformation made no change'};" +
    "try{[void](Assert-NativeGuiStartupTaskXml -XmlText $bad -State $state -ExpectedEnabled $true);throw 'Invalid task XML accepted'}catch{if($_.Exception.Message -eq 'Invalid task XML accepted'){throw};$refused++}};" +
    "foreach($bad in @($good.Replace('<Enabled>true</Enabled>','<Enabled>false</Enabled>'),$good.Replace('RegistrationId='+('a'*32),'RegistrationId=foreign'),$good.Replace('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',''),$good.Replace('<AllowStartOnDemand>false</AllowStartOnDemand>',''))){" +
    "try{[void](Assert-NativeGuiStartupTaskXml -XmlText $bad -State $state -ExpectedEnabled $true);throw 'Bad normalized XML accepted'}catch{if($_.Exception.Message -eq 'Bad normalized XML accepted'){throw};$refused++}};" +
    "foreach($case in @(@{name='owner';value='Foreign'},@{name='purpose';value='Other'},@{name='userSid';value='S-1-5-18'},@{name='taskName';value='foreign'},@{name='taskPath';value='\\foreign'})){" +
    "$bad=$state.Clone();$bad[$case.name]=$case.value;try{[void](Assert-NativeGuiStartupTaskXml -XmlText $good -State $bad -ExpectedEnabled $true);throw 'Invalid task identity accepted'}catch{if($_.Exception.Message -eq 'Invalid task identity accepted'){throw};$refused++}};" +
    "@{acceptedEnabled=$proof.enabled;acceptedDisabled=$true;refused=$refused;physicalMutations=0}|ConvertTo-Json -Compress";
  const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { acceptedEnabled: true, acceptedDisabled: true, refused: 20, physicalMutations: 0 });
});

test('packaged startup task lifecycle uses the public helper and resumes only after verified service and DNS restoration', async () => {
  const [native, reinstall, packager, inventory, nsi] = await Promise.all([
    fs.readFile('tests/windows-production-acceptance.ps1', 'utf8'),
    fs.readFile('scripts/invoke-final-silent-reinstall.ps1', 'utf8'),
    fs.readFile('scripts/package-windows.mjs', 'utf8'),
    fs.readFile('scripts/worker-host-integrity.mjs', 'utf8'),
    fs.readFile('src/installer/setup.nsi', 'utf8'),
  ]);
  assert.match(packager, /resources\/installer\/gui-login-startup\.ps1/);
  assert.match(inventory, /add\('resources\/installer\/gui-login-startup\.ps1', \['gui'\]\)/);
  assert.match(nsi, /File \/oname=\$PLUGINSDIR\\gui-login-startup\.ps1 "\$\{PAYLOAD\}\\resources\\installer\\gui-login-startup\.ps1"/);
  assert.match(nsi, /CopyFiles \/SILENT "\$INSTDIR\\resources\\installer\\gui-login-startup\.ps1" "\$PLUGINSDIR\\gui-login-startup\.ps1"/);
  assert.match(reinstall, /Staged GUI login startup helper failed immutable SHA-256 readback/);
  const enter = reinstall.slice(reinstall.indexOf('function Enter-InstallerServiceMaintenance {'), reinstall.indexOf('function Complete-InstallerServiceMaintenance {'));
  assert.match(enter, /Write-JsonAtomic -Path \$marker[\s\S]*?Suspend-OwnedGuiLoginStartup/);
  const complete = reinstall.slice(reinstall.indexOf('function Complete-InstallerServiceMaintenance {'), reinstall.indexOf('function Get-InstallerServiceMaintenanceStatus {'));
  assert.match(complete, /Remove-Item -LiteralPath \$marker -Force -ErrorAction Stop[\s\S]*?Resume-OwnedGuiLoginStartup/);
  assert.match(complete, /-not \(Test-Path -LiteralPath \$marker -PathType Leaf\)\) \{ Resume-OwnedGuiLoginStartup; return \}/);
  const recovery = reinstall.slice(reinstall.indexOf('function Invoke-Recovery {'), reinstall.indexOf('function Stop-VerifiedInstallerTransactionProcess {'));
  assert.match(recovery, /\$recoveryErrors\.Count -gt 0[\s\S]*?return \$false[\s\S]*?else[\s\S]*?Complete-InstallerServiceMaintenance/);
  assert.match(recovery, /maintenanceStatus -eq 'absent'\) \{\s*Resume-OwnedGuiLoginStartup/g);
  const worker = reinstall.slice(reinstall.indexOf('Write-Heartbeat -Stage $StageDirectory -Phase "restoring"'));
  assert.ok(worker.indexOf('Start-PreservedServices -State $state') < worker.indexOf('Complete-InstallerServiceMaintenance'));
  assert.ok(worker.indexOf('Restored adapter DNS did not pass readback.') < worker.indexOf('Complete-InstallerServiceMaintenance'));
  assert.ok(worker.indexOf('Complete-InstallerServiceMaintenance') < worker.indexOf('Unregister-InstallerMaintenanceBootRecovery'));
  assert.match(native, /Invoke-NativeGuiStartupOperation -Operation Sync -Enabled true/);
  assert.match(native, /Observe-NativeGuiStartupSuspension/);
  assert.match(native, /Invoke-NativeGuiStartupOperation -Operation Verify[\s\S]*?restoredAfterReinstall=\$true/);
  assert.match(native, /Invoke-NativeGuiStartupOperation -Operation Sync -Enabled false[\s\S]*?actual-packaged-gui-startup-highest-interactive-enable-suspend-restore-disable/);
  assert.match(native, /task registration differs from the originally authenticated enabled task/);
  assert.match(native, /actualLogonExecuted=\$false;actualSettingsToggleInvoked=\$false/);
});

test('actual reinstall functions keep GUI startup suspended on failed restoration and resume after closing their own marker', {
  skip: process.platform !== 'win32' || !process.env.LAGOM_TEST_TEMP,
}, async () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || process.env.LAGOM_WINDOWS_POWERSHELL ||
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const directory = await fs.mkdtemp(path.join(process.env.LAGOM_TEST_TEMP, 'startup-hook-'));
  const quote = value => value.replaceAll("'", "''");
  const body = "$ErrorActionPreference='Stop';$script:OwnedDataRoot='" + quote(directory) + "';$StageDirectory=(Join-Path $script:OwnedDataRoot 'stage');" +
    "$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('" + quote(path.resolve('scripts/invoke-final-silent-reinstall.ps1')) + "',[ref]$tokens,[ref]$errors);" +
    "if($errors.Count){throw 'Production helper did not parse'};" +
    "foreach($name in @('Enter-InstallerServiceMaintenance','Complete-InstallerServiceMaintenance','Invoke-Recovery')){" +
    "$nodes=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($nodes.Count -ne 1){throw 'Actual function identity ambiguous'};Invoke-Expression $nodes[0].Extent.Text};" +
    "$script:Events=[Collections.Generic.List[string]]::new();" +
    "function Assert-PlainWrapperMigrationPath {param($Path,$Root)return $Path};function Protect-StageDirectory {};" +
    "function Write-JsonAtomic {param($Path,$Value)[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json));$script:Events.Add('marker-created')};" +
    "function Suspend-OwnedGuiLoginStartup {if(-not(Test-Path -LiteralPath (Join-Path $script:OwnedDataRoot 'installer\\service-maintenance.json'))){throw 'Suspend before trusted marker'};$script:Events.Add('suspend')};" +
    "function Resume-OwnedGuiLoginStartup {if(Test-Path -LiteralPath (Join-Path $script:OwnedDataRoot 'installer\\service-maintenance.json')){throw 'Resume before marker removal'};$script:Events.Add('resume')};" +
    "$marker=Join-Path $script:OwnedDataRoot 'installer\\service-maintenance.json';Enter-InstallerServiceMaintenance;Enter-InstallerServiceMaintenance;" +
    "if(($script:Events -join ',') -cne 'marker-created,suspend,suspend'){throw 'Maintenance entry hook order differs'};" +
    "$good=[IO.File]::ReadAllText($marker);[IO.File]::WriteAllText($marker,('{\"schemaVersion\":1,\"owner\":\"Foreign\",\"stage\":\"foreign\"}'));$refused=0;" +
    "foreach($name in @('Enter-InstallerServiceMaintenance','Complete-InstallerServiceMaintenance')){try{& $name;throw 'Foreign marker accepted'}catch{if($_.Exception.Message -eq 'Foreign marker accepted'){throw};$refused++}};" +
    "if($script:Events.Count -ne 3){throw 'Foreign transaction invoked startup hook'};[IO.File]::WriteAllText($marker,$good);Complete-InstallerServiceMaintenance;Complete-InstallerServiceMaintenance;" +
    "if(($script:Events -join ',') -cne 'marker-created,suspend,suspend,resume,resume'){throw 'Completion/retry hook order differs'};" +
    "function Enter-DeferredReinstallRecoveryLease {$m=[pscustomobject]@{};$m|Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value {};$m|Add-Member -MemberType ScriptMethod -Name Dispose -Value {};return $m};" +
    "function Get-InstallerServiceMaintenanceStatus {return 'own'};function Add-ReceiptEvent {};" +
    "function Stop-OwnedServiceForInstall {};function Stop-PreservedWrappersForRecovery {};" +
    "function Restore-PreservedState {if($script:Fault -ceq 'state'){throw 'Inert state restore failure'}};" +
    "function Reconcile-PreservedZapretProfile {};function Restore-InstalledIdentity {};function Test-PayloadRollbackPending {return $false};" +
    "function Restore-PreservedServiceStartModes {};function Start-PreservedServices {if($script:Fault -ceq 'services'){throw 'Inert service restore failure'}};" +
    "function Test-LoopbackDnsReady {return $true};function Restore-CriticalAdapterDns {if($script:Fault -ceq 'dns'){throw 'Inert DNS restore failure'}};" +
    "function Restore-CriticalOwnedDnsBaseline {};function Start-InstalledDesktop {throw 'GUI must not launch in fixture'};" +
    "$state=[pscustomobject]@{runAfter=$false;services=@();criticalDns=@([pscustomobject]@{interfaceIndex=17;servers=@('127.0.0.1')})};$failureCases=0;" +
    "foreach($fault in @('state','services','dns')){$script:Fault=$fault;[IO.File]::WriteAllText($marker,$good);$before=$script:Events.Count;" +
    "$result=Invoke-Recovery -State $state -Reason 'inert owned boundary fixture';if($result -ne $false -or -not(Test-Path -LiteralPath $marker) -or $script:Events.Count -ne $before){throw 'Failed restoration reopened GUI startup or lost maintenance marker'};$failureCases++};" +
    "$script:Fault='';$result=Invoke-Recovery -State $state -Reason 'inert owned boundary fixture';if($result -ne $true -or (Test-Path -LiteralPath $marker) -or $script:Events[$script:Events.Count-1] -cne 'resume'){throw 'Verified restoration did not close marker before resume'};" +
    "@{foreignTransactionsRefused=$refused;failedRestoreCases=$failureCases;successfulRestore=$true;liveServiceMutations=0;liveDnsMutations=0;liveTaskMutations=0}|ConvertTo-Json -Compress";
  try {
    const child = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', body],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      foreignTransactionsRefused: 2, failedRestoreCases: 3, successfulRestore: true,
      liveServiceMutations: 0, liveDnsMutations: 0, liveTaskMutations: 0,
    });
  } finally {
    assert.equal(path.dirname(directory), path.resolve(process.env.LAGOM_TEST_TEMP));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
