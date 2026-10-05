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

test('actual VPN native select accepts conditional UIA providers and refuses ambiguous or foreign state', { skip: process.platform !== 'win32' }, () => {
  const shell = process.env.LAGOM_TEST_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const source = path.resolve(process.env.LAGOM_VPN_SELECTION_SOURCE || 'tests/windows-vpn-native-acceptance.ps1').replaceAll("'", "''");
  const command = `
    $ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes;
    $tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('${source}',[ref]$tokens,[ref]$errors);
    if($errors.Count){throw 'Actual VPN helper AST has errors.'};
    $defs=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Select-VpnUiOption'},$false));
    if($defs.Count -ne 1){throw 'Actual select helper must have one definition.'};Invoke-Expression $defs[0].Extent.Text;
    $script:VpnGuiLease=@{Receipt=@{processId=4232}};$script:results=[Collections.Generic.List[object]]::new();
    function Item([string]$Name,[int]$GuiProcessId,[bool]$Selected,[bool]$Stale=$false){
      $pattern=[pscustomobject]@{Info=[pscustomobject]@{IsSelected=$Selected};Stale=$Stale};
      $pattern|Add-Member ScriptProperty Current {if($this.Stale){throw 'FIXTURE_STALE_ITEM'};return $this.Info};
      $pattern|Add-Member ScriptMethod Select {$script:events.Add('select');if($script:selectError){throw 'FIXTURE_SELECT_ERROR'}};
      $item=[pscustomobject]@{Current=[pscustomobject]@{Name=$Name;ProcessId=$GuiProcessId};Pattern=$pattern};
      $item|Add-Member ScriptMethod TryGetCurrentPattern {param($id,$result);if($id -eq [Windows.Automation.SelectionItemPattern]::Pattern){$result.Value=$this.Pattern;return $true};return $false};return $item;
    }
    function Setup([bool]$Supported){
      $script:events=[Collections.Generic.List[string]]::new();$script:evidence=0;$script:supported=$Supported;$script:providerError=$false;$script:selectError=$false;
      $script:option=Item 'Requested option' 4232 $true;$script:selected=@($script:option);
      $script:expansion=[pscustomobject]@{};$script:expansion|Add-Member ScriptMethod Expand {$script:events.Add('expand')};$script:expansion|Add-Member ScriptMethod Collapse {$script:events.Add('collapse')};
      $script:container=[pscustomobject]@{};$script:container|Add-Member ScriptMethod GetCurrentSelection {$script:events.Add('container-read');if($script:providerError){throw 'FIXTURE_PROVIDER_ERROR'};return $script:selected};
      $script:combo=[pscustomobject]@{Current=[pscustomobject]@{ControlType=[Windows.Automation.ControlType]::ComboBox}};
      $script:combo|Add-Member ScriptMethod TryGetCurrentPattern {param($id,$result);
        if($id -eq [Windows.Automation.ExpandCollapsePattern]::Pattern){$result.Value=$script:expansion;return $true};
        if($id -eq [Windows.Automation.SelectionPattern]::Pattern -and $script:supported){$result.Value=$script:container;return $true};return $false};
      $script:combo|Add-Member ScriptMethod GetCurrentPattern {param($id);if(-not $script:supported){throw 'Unsupported Pattern.'};return $script:container};
      $script:combo|Add-Member ScriptMethod FindAll {param($scope,$condition);$script:events.Add('item-read');return $script:selected};
    }
    function Find-VpnUiElement {param($Name,$ControlType,$Scope,$TimeoutSeconds);if($Scope){if($TimeoutSeconds -ne 15){throw 'Option lookup budget changed.'};return $script:option};return $script:combo}
    function Add-VpnEvidence {param($Name,$Value);$script:evidence++;$script:events.Add('evidence')}
    function Invoke-Control {Select-VpnUiOption -Name 'Fixture combo' -Option 'Requested option'}
    function Refuses([string]$Pattern){$refused=$false;try{Invoke-Control}catch{$refused=$true;if($_.Exception.Message -notmatch $Pattern){throw ('Wrong refusal: '+$_.Exception.Message)}};if(-not $refused -or $script:evidence){throw 'Unsafe selection was accepted.'};if($script:events[-1] -cne 'collapse'){throw 'Failure did not collapse the genuine select.'}}
    function Case([string]$Name,[scriptblock]$Action){try{&$Action;$script:results.Add(@{name=$Name;passed=$true})}catch{$script:results.Add(@{name=$Name;passed=$false;error=$_.Exception.Message})}}
    Case 'supported-container-selection-retained' {Setup $true;Invoke-Control;if($script:evidence -ne 1 -or -not $script:events.Contains('container-read') -or $script:events.Contains('item-read')){throw 'Supported container path changed.'}}
    Case 'unsupported-container-selected-item-accepted' {Setup $false;Invoke-Control;if($script:evidence -ne 1 -or -not $script:events.Contains('item-read') -or $script:events[-1] -cne 'collapse'){throw 'Native item path was not verified before collapse.'}}
    Case 'no-selected-item-refused' {Setup $false;$script:selected=@();Refuses 'did not retain'}
    Case 'multiple-selected-items-refused' {Setup $false;$script:selected+=Item 'Other option' 4232 $true;Refuses 'did not retain'}
    Case 'wrong-selected-name-refused' {Setup $false;$script:selected=@(Item 'Wrong option' 4232 $true);Refuses 'did not retain'}
    Case 'foreign-selected-process-refused-in-both-routes' {foreach($supported in @($false,$true)){Setup $supported;$script:selected=@(Item 'Requested option' 9999 $true);Refuses 'did not retain'}}
    Case 'unselected-candidate-refused' {Setup $false;$script:selected=@(Item 'Requested option' 4232 $false);Refuses 'did not retain'}
    Case 'stale-item-state-fails-closed' {Setup $false;$script:selected=@(Item 'Requested option' 4232 $true $true);Refuses 'FIXTURE_STALE_ITEM|did not retain'}
    Case 'provider-error-fails-closed' {Setup $true;$script:providerError=$true;Refuses 'FIXTURE_PROVIDER_ERROR'}
    Case 'select-error-fails-closed' {Setup $false;$script:selectError=$true;Refuses 'FIXTURE_SELECT_ERROR'}
    $passed=@($script:results|Where-Object {$_.passed}).Count;
    @{actualFunctionExtracted=$true;groups=$script:results.Count;passed=$passed;results=$script:results.ToArray();actualGuiActions=0;liveMutations=0}|ConvertTo-Json -Depth 5 -Compress;
    if($passed -ne $script:results.Count){exit 1};
  `;
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, [result.error?.code, result.signal, result.stdout, result.stderr].filter(Boolean).join('\n'));
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.actualFunctionExtracted, true); assert.equal(receipt.groups, 10); assert.equal(receipt.passed, 10);
  assert.equal(receipt.actualGuiActions + receipt.liveMutations, 0);
});
