param([Parameter(Mandatory=$true)][string]$SourcePath)
$ErrorActionPreference='Stop'
# Load trusted built-ins before defining inert adapters; PS5 autoload must not replace a mock.
foreach($module in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management')){
  Import-Module -Name (Join-Path $PSHOME ('Modules\'+$module+'\'+$module+'.psd1')) -ErrorAction Stop
}
$tokens=$null;$errors=$null
$source=[IO.File]::ReadAllText($SourcePath)
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Actual source parse failed.'}
function Find-ActualFunction([string]$Name){
  $found=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $Name},$true))
  if($found.Count -ne 1){throw ('Expected one actual source function: '+$Name)}
  return $found[0].Extent.Text
}
$assertSource=Find-ActualFunction 'Assert-DnsBaselineRestored'
$saveSource=Find-ActualFunction 'Save-DnsFailedBaselineInventory'
$cleanup=@($ast.FindAll({param($node)
  $node -is [Management.Automation.Language.TryStatementAst] -and $node.CatchClauses.Count -eq 1 -and
  $node.CatchClauses[0].Body.Extent.Text -ceq '{$script:Receipt.guiFailureCleanupError=$_.Exception.Message}' -and
  $node.Body.Extent.Text.Contains("Invoke-DnsElevatedGui 'Reset'")
},$true))
if($cleanup.Count -ne 1){throw 'Expected exactly the actual final post-Reset cleanup consumer.'}
$cleanupBlock=[scriptblock]::Create($cleanup[0].Extent.Text)
. ([scriptblock]::Create($assertSource))
# No native bootstrap/GUI/registry/DNS implementation is imported or executed.
function Get-DnsNativeInventory {
  $script:InventoryReads++
  if($script:InventoryError){throw $script:InventoryError}
  return $script:CurrentInventory
}
function Invoke-DnsElevatedGui([string]$Operation){
  if($Operation -cne 'Reset'){throw 'Unexpected operation in isolated cleanup.'}
  $script:ResetCalls++
  if($script:ResetError){throw $script:ResetError}
}
function Test-Path { param($LiteralPath,$Path) return [bool]$script:IntentRemaining }
function Assert-NativeService {
  param($Name,$Path,[switch]$Running)
  $script:ServiceChecks++
  if($script:ServiceError){throw $script:ServiceError}
}
function Assert-DnsNativeHost { $script:HostChecks++;throw 'Native host must never be reached by inert saver guard controls.' }
function Require([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
function New-Baseline {
  return [ordered]@{
    adapters=@([ordered]@{index=14;servers=@('168.63.129.16')})
    doh=@([ordered]@{serverAddress='1.1.1.1';allowFallbackToUdp=$true})
    registry=[ordered]@{fixture='original'}
    network=[ordered]@{fixture='original'}
    tasks=@([ordered]@{path='\OwnedFixture\';name='OwnedTask';definitionSha256=('a'*64)})
    productServices=@([ordered]@{Name='OwnedFixture';StartMode='Auto';StartName='LocalSystem';PathName='inert'})
  }
}
$script:Cases=@()
function Invoke-Case([string]$Name,[hashtable]$Setup,[scriptblock]$Check){
  $script:DnsBefore=New-Baseline;$script:CurrentInventory=New-Baseline
  $script:DnsLibraryOnly=$false;$script:DnsNativeMode='Run'
  $script:DataRoot='C:\Inert-Fixture-Not-Accessed';$script:Core='C:\Inert-Core-Not-Accessed.exe'
  $script:Receipt=[ordered]@{sourceCommit=('a'*40);result='failed';releaseReady=$false}
  $script:InventoryReads=0;$script:ResetCalls=0;$script:ServiceChecks=0;$script:HostChecks=0;$script:SaveCalls=0
  $script:InventoryError=$null;$script:ResetError=$null;$script:ServiceError=$null;$script:IntentRemaining=$false
  $script:SavedObservation=$null;$script:SaveError=$null;$script:DnsFailedBaselineCaptured=$false
  $script:StaleObservation=[ordered]@{observedAtUtc='2000-01-01T00:00:00Z';current=[ordered]@{fixture='stale-before-reset'}}
  $script:DnsLastFailedBaselineObservation=$script:StaleObservation
  function Save-DnsFailedBaselineInventory {
    param($Observation)
    # The existing byte/host/path guarded saver is unchanged. This memory adapter
    # isolates the consumer's wiring/error handling, never creating an artifact.
    $script:SaveCalls++
    if($script:SaveError){throw $script:SaveError}
    $script:SavedObservation=$Observation
    $script:Receipt.baselineFailureInventory=[ordered]@{currentInventoryCaptured=$true;baselineUnmodified=$true;fixtureMemoryOnly=$true}
  }
  if($Setup.ContainsKey('Mismatch')){$script:CurrentInventory.registry.fixture='changed-after-reset'}
  if($Setup.ContainsKey('TaskMismatch')){$script:CurrentInventory.tasks[0].definitionSha256=('b'*64)}
  if($Setup.ContainsKey('ResetError')){$script:ResetError=[InvalidOperationException]::new('Owned reset failed before post-close assertion')}
  if($Setup.ContainsKey('InventoryError')){$script:InventoryError=[InvalidOperationException]::new('Owned inventory read failed')}
  if($Setup.ContainsKey('ServiceError')){$script:ServiceError=[InvalidOperationException]::new('Owned service verification failed')}
  if($Setup.ContainsKey('IntentRemaining')){$script:IntentRemaining=$true}
  if($Setup.ContainsKey('SaveError')){$script:SaveError=[InvalidOperationException]::new('Owned diagnostic writer failed')}
  if($Setup.ContainsKey('Library')){$script:DnsLibraryOnly=$true}
  if($Setup.ContainsKey('Guardian')){$script:DnsNativeMode='Guardian'}
  if($Setup.ContainsKey('Captured')){$script:DnsFailedBaselineCaptured=$true;$script:Receipt.baselineFailureInventory=[ordered]@{priorCapture='preserved'}}
  if($Setup.ContainsKey('ActualSaver')){. ([scriptblock]::Create($saveSource))}
  $restored=$false;$originalFailure=[InvalidOperationException]::new('Owned original query failure');$failure=$originalFailure
  try{
    . $cleanupBlock
    & $Check $restored $failure $originalFailure
    $script:Cases+=@([ordered]@{name=$Name;passed=$true})
  }catch{$script:Cases+=@([ordered]@{name=$Name;passed=$false;error=$_.Exception.Message})}
}
$originalMismatch='Original DNS/DoH registry, API, adapters, proxy, routes, IPv6 bindings or Task definitions were not restored exactly.'
function Check-CapturedMismatch([bool]$Restored){
  Require (-not $Restored) 'Mismatch must remain unrestored.'
  Require ($script:SaveCalls -eq 1) 'Fresh post-close mismatch must invoke the saver exactly once.'
  Require ([object]::ReferenceEquals($script:SavedObservation.current,$script:CurrentInventory)) 'Capture must retain the exact already-computed failed inventory.'
  Require (-not [object]::ReferenceEquals($script:SavedObservation,$script:StaleObservation)) 'Stale pre-Reset observation must never be presented as post-close evidence.'
  Require ($script:InventoryReads -eq 1) 'Capture must not perform a fresh inventory query.'
  Require ($script:Receipt.guiFailureCleanupError -ceq $originalMismatch) 'Original equality error must be retained.'
  Require ($script:Receipt.result -ceq 'failed' -and -not $script:Receipt.releaseReady) 'Evidence must not promise restored/native pass.'
}
Invoke-Case 'post-close mismatch saves the latest complete failed inventory' @{Mismatch=$true} {param($restored)Check-CapturedMismatch $restored}
Invoke-Case 'saved observation differs from stale pre-Reset observation' @{Mismatch=$true} {param($restored)
  Check-CapturedMismatch $restored
  Require ($script:SavedObservation.current.registry.fixture -ceq 'changed-after-reset') 'Incorrect captured phase/value.'
}
Invoke-Case 'unrelated Task definition mismatch stays fatal and is captured' @{TaskMismatch=$true} {param($restored)
  Check-CapturedMismatch $restored
  Require ($script:SavedObservation.current.tasks[0].definitionSha256 -ceq ('b'*64)) 'Task mismatch was discarded.'
}
Invoke-Case 'diagnostic failure preserves the original equality error' @{Mismatch=$true;SaveError=$true} {param($restored)
  Require (-not $restored) 'Writer failure must not restore state.'
  Require ($script:SaveCalls -eq 1) 'Saver was not attempted.'
  Require ($script:Receipt.guiFailureCleanupError -ceq $originalMismatch) 'Diagnostic error replaced original failure.'
  Require ($script:Receipt.Contains('baselineFailureInventoryError')) 'Diagnostic failure classification absent.'
  Require ($script:Receipt.baselineFailureInventoryError.class -ceq 'System.InvalidOperationException') 'Diagnostic error class incorrect.'
  Require ($script:InventoryReads -eq 1) 'Writer failure caused a new query.'
}
Invoke-Case 'Reset failure must not save an earlier stale observation' @{ResetError=$true} {param($restored)
  Require (-not $restored -and $script:SaveCalls -eq 0 -and $script:InventoryReads -eq 0) 'Reset failure was falsely treated as a post-close mismatch.'
  Require ($script:Receipt.guiFailureCleanupError -ceq 'Owned reset failed before post-close assertion') 'Reset error lost.'
}
Invoke-Case 'unchanged inventory remains restored and original query failure remains fatal' @{} {param($restored,$failure,$original)
  Require ($restored -and $script:SaveCalls -eq 0) 'Successful comparison changed.'
  Require ([object]::ReferenceEquals($failure,$original)) 'Cleanup replaced original query failure.'
  Require ($script:Receipt.result -ceq 'failed' -and -not $script:Receipt.releaseReady) 'Cleanup granted native PASS.'
}
Invoke-Case 'protected-intent failure without new inventory mismatch does not save stale evidence' @{IntentRemaining=$true} {param($restored)
  Require (-not $restored -and $script:SaveCalls -eq 0) 'Intent failure saved stale inventory.'
  Require ($script:Receipt.guiFailureCleanupError -ceq 'Protected DNS ownership intent remains after GUI disable.') 'Intent error lost.'
}
Invoke-Case 'service failure without new inventory mismatch does not save stale evidence' @{ServiceError=$true} {param($restored)
  Require (-not $restored -and $script:SaveCalls -eq 0) 'Service failure saved stale inventory.'
  Require ($script:Receipt.guiFailureCleanupError -ceq 'Owned service verification failed') 'Service error lost.'
}
Invoke-Case 'inventory read failure does not save an earlier observation' @{InventoryError=$true} {param($restored)
  Require (-not $restored -and $script:SaveCalls -eq 0 -and $script:InventoryReads -eq 1) 'Failed read became fabricated evidence.'
  Require ($script:Receipt.guiFailureCleanupError -ceq 'Owned inventory read failed') 'Read error lost.'
}
Invoke-Case 'Library consumer mismatch uses actual saver guard and makes no host/file actions' @{Mismatch=$true;Library=$true;ActualSaver=$true} {param($restored)
  Require (-not $restored -and $script:HostChecks -eq 0) 'Library mode reached host work.'
  Require (-not $script:Receipt.Contains('baselineFailureInventory') -and -not $script:Receipt.Contains('baselineFailureInventoryError')) 'Library mode created evidence metadata.'
  Save-DnsFailedBaselineInventory $script:StaleObservation
  Require ($script:HostChecks -eq 0 -and -not $script:DnsFailedBaselineCaptured) 'Actual Library saver guard failed.'
}
Invoke-Case 'Guardian consumer mismatch uses actual saver guard and makes no host/file actions' @{Mismatch=$true;Guardian=$true;ActualSaver=$true} {param($restored)
  Require (-not $restored -and $script:HostChecks -eq 0) 'Guardian mode reached host work.'
  Require (-not $script:Receipt.Contains('baselineFailureInventory') -and -not $script:Receipt.Contains('baselineFailureInventoryError')) 'Guardian mode created evidence metadata.'
  Save-DnsFailedBaselineInventory $script:StaleObservation
  Require ($script:HostChecks -eq 0 -and -not $script:DnsFailedBaselineCaptured) 'Actual Guardian saver guard failed.'
}
Invoke-Case 'actual first-capture guard preserves earlier artifact and cannot call host' @{Mismatch=$true;Captured=$true;ActualSaver=$true} {param($restored)
  Require (-not $restored -and $script:HostChecks -eq 0) 'Deduplicated capture reached host work.'
  Require ($script:Receipt.baselineFailureInventory.priorCapture -ceq 'preserved') 'Earlier artifact was overwritten.'
  Require ($script:Receipt.guiFailureCleanupError -ceq $originalMismatch) 'Deduplication rescued failure.'
}
$failed=@($script:Cases|Where-Object {-not $_.passed})
$report=[ordered]@{schemaVersion=1;powerShellVersion=$PSVersionTable.PSVersion.ToString();sourceFile=$SourcePath;sourceParseErrors=$errors.Count;actualFunctions=@('Assert-DnsBaselineRestored','Save-DnsFailedBaselineInventory guard cases only');consumer='Exact source final cleanup TryStatementAst';passed=($script:Cases.Count-$failed.Count);failed=$failed.Count;cases=$script:Cases;nativeBootstrapEvaluated=$false;nativeQueries=0;fileWrites=0;state='Inert memory adapters; existing saver host/path/byte implementation unchanged'}
$report|ConvertTo-Json -Depth 9 -Compress
if($failed.Count){exit 1}
