# Actual production functions only; the full worker and native commands are never executed.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Work,[Parameter(Mandatory=$true)][string]$SourcePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$trustedWork=$env:LAGOM_TEST_TEMP
if(-not $trustedWork -and $env:GITHUB_ACTIONS -eq 'true'){$trustedWork=$env:RUNNER_TEMP}
if(-not $trustedWork -or -not [IO.Path]::IsPathRooted($trustedWork)){throw 'Absolute task-owned LAGOM_TEST_TEMP or CI RUNNER_TEMP is required.'}
$trustedWork=[IO.Path]::GetFullPath($trustedWork).TrimEnd('\')
$script:Root=[IO.Path]::GetFullPath($Work).TrimEnd('\')
if(-not $script:Root.StartsWith($trustedWork+'\',[StringComparison]::OrdinalIgnoreCase)-or(Test-Path -LiteralPath $script:Root)){throw 'Use fresh child of the declared test work.'}
$SourcePath=[IO.Path]::GetFullPath($SourcePath)
[void][IO.Directory]::CreateDirectory($script:Root)
$script:StageDirectory=Join-Path $script:Root 'stage'
$script:RuntimeRoot=Join-Path $script:Root 'runtime'
$script:OwnedDataRoot=Join-Path $script:Root 'data'
foreach($d in @($StageDirectory,$script:RuntimeRoot,(Join-Path $StageDirectory 'runtime-backup'),(Join-Path $StageDirectory 'runtime-backup\Vpn'))){[void][IO.Directory]::CreateDirectory($d)}
[IO.File]::WriteAllText((Join-Path $StageDirectory 'runtime-backup\Vpn\.inert-sentinel'),'only-own-fixture',[Text.UTF8Encoding]::new($false))
$script:Copies=New-Object 'Collections.Generic.List[object]'
$script:Events=New-Object 'Collections.Generic.List[object]'
$script:Guards=New-Object 'Collections.Generic.List[string]'
$script:Rows=New-Object 'Collections.Generic.List[object]'
$script:Loaded=New-Object 'Collections.Generic.List[object]'
$script:NativeCalls=0
$script:Maintenance='owned'
$script:CopyExit=0
function Require([bool]$Value,[string]$Why){if(-not $Value){throw $Why}}
function Assert-Own([string]$p){$a=[IO.Path]::GetFullPath($p);Require ($a.StartsWith($script:Root+'\',[StringComparison]::OrdinalIgnoreCase)-or$a-eq$script:Root) 'Forbidden foreign filesystem path';return $a}
function Assert-PlainWrapperMigrationPath {param([string]$Path,[string]$Root) [void](Assert-Own $Root);$a=Assert-Own $Path;$script:Guards.Add('own-migration-path');return $a}
function Protect-InstallerStageTree {param([string]$Stage)[void](Assert-Own $Stage);$script:Guards.Add('inert-stage-protection')}
function Assert-SystemDohPayloadContinuity {param($State)$script:Guards.Add('inert-payload-continuity');return $true}
function robocopy.exe {
 $values=@($args);[void](Assert-Own ([string]$values[0]));[void](Assert-Own ([string]$values[1]))
 $script:Copies.Add([pscustomobject]@{arguments=$values;exitCode=$script:CopyExit})
 $global:LASTEXITCODE=$script:CopyExit
}
function sc.exe {throw 'Forbidden native SCM'}
function reg.exe {throw 'Forbidden registry'}
function Get-Service {throw 'Forbidden native service read'}
function Get-CimInstance {throw 'Forbidden native CIM'}
function Start-Service {throw 'Forbidden native service start'}
function Stop-Service {throw 'Forbidden native service stop'}
function Stop-Process {throw 'Forbidden host process control'}
function Start-Process {throw 'Forbidden host process launch'}
function Set-Acl {throw 'Forbidden native ACL'}
function Stop-InstallerOwnedService {param($Name,$Validator)Require ($Name-ceq'EgoistShieldCore') 'Unexpected service';$script:Guards.Add('inert-stop-exact-Core')}
function Test-OwnedServicePath {param($Path)throw 'Unexpected real service-path adapter'}
function Get-InstallerServiceMaintenanceStatus {return $script:Maintenance}
function Enter-DeferredReinstallRecoveryLease {
 $v=[pscustomobject]@{}
 $v|Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value {$script:Guards.Add('inert-lease-release')}
 $v|Add-Member -MemberType ScriptMethod -Name Dispose -Value {$script:Guards.Add('inert-lease-dispose')}
 return $v
}
function Add-ReceiptEvent {param($Stage,$Status,$Message,$Data)$script:Events.Add([pscustomobject]@{stage=$Stage;status=$Status;message=$Message})}
function Reconcile-PreservedZapretProfile {param($State)Require ($State.zapretProfile-ceq'') 'Unexpected profile';$script:Guards.Add('inert-empty-zapret')}
function Restore-InstalledIdentity {param($State)$script:Guards.Add('inert-identity')}
function Test-PayloadRollbackPending {return $false}
function Restore-PreservedServiceStartModes {param($State)$script:Guards.Add('inert-start-modes')}
function Refresh-OwnedCoreProtectedConfiguration {$script:Guards.Add('inert-Core-config')}
function Start-PreservedServices {param($State,[switch]$PreservedRuntimeRecovery)$script:Guards.Add('inert-services-restored')}
function Test-OwnedSystemDohRecoveryRuntime {throw 'Unexpected private-runtime adapter'}
function Test-LoopbackDnsReady {param($State)Require (@($State.criticalDns).Count-eq0) 'Unexpected DNS fixture';return $true}
function Restore-CriticalAdapterDns {throw 'Forbidden actual DNS'}
function Complete-InstallerServiceMaintenance {$script:Maintenance='absent';$script:Guards.Add('inert-maintenance-closed')}
function Resume-OwnedGuiLoginStartup {$script:Guards.Add('inert-gui-startup-resumed')}
function Start-InstalledDesktop {throw 'Forbidden actual GUI'}
function Test-InstallerServiceMaintenanceOwner {return $script:Maintenance-eq'owned'}
function Write-PendingInstallerRecovery {param($Reason,$Attempts)
 $p=Join-Path $StageDirectory 'recovery-pending.json'
 [IO.File]::WriteAllText($p,(@{owner='EgoistShield';attempts=$Attempts;reason=$Reason}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
 $script:Events.Add([pscustomobject]@{stage='recovery';status='recovery-warning';message=$Reason})
}
$tokens=$null;$parseErrors=$null
$script:ActualAst=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$parseErrors)
Require ($parseErrors.Count-eq0) 'Actual helper parse failed'
$callee=$script:ActualAst.Find({param($n)$n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq'Invoke-RobocopyDirectory'},$true)
Require ($null-ne$callee) 'Missing actual copy function'
$countExpressions=@($callee.FindAll({param($n)$n-is[Management.Automation.Language.MemberExpressionAst]-and$n.Member.Extent.Text-eq'Count'},$true))
Require ($countExpressions.Count-eq1) 'Expected one actual copy Count expression'
$script:CountLine=$countExpressions[0].Extent.StartLineNumber
function Load-Actual([bool]$LegacyAssignment){
 foreach($name in @('Restore-PreservedState','Invoke-RobocopyDirectory','Restore-CriticalDnsState','Get-FileSha256','Stop-PreservedWrappersForRecovery','Stop-OwnedServiceForInstall','Invoke-Recovery','Invoke-InstallerRecoveryAttempts')){
  $f=$script:ActualAst.Find({param($n)$n-is[Management.Automation.Language.FunctionDefinitionAst]-and$n.Name-eq$name},$true)
  Require ($null-ne$f) ('Missing actual function '+$name)
  $body=$f.Extent.Text
  if($LegacyAssignment-and$name-eq'Restore-PreservedState'){
   $assignments=@($f.FindAll({param($n)$n-is[Management.Automation.Language.AssignmentStatementAst]-and$n.Left.Extent.Text-eq'$excluded'},$true))
   Require ($assignments.Count-eq1) 'Expected one actual restore exclude assignment'
   $assignment=$assignments[0];$offset=$assignment.Extent.StartOffset-$f.Extent.StartOffset
   $wrong='$excluded = if ($PreserveSystemDohRuntime) { @(Join-Path $runtimeBackup ''SystemDoH'') } else { @() }'
   $body=$body.Substring(0,$offset)+$wrong+$body.Substring($offset+$assignment.Extent.Text.Length)
  }
  $body=$body -replace '^function ','function script:'
  $prefix=[string]::new([char]10,($f.Extent.StartLineNumber-1))
  . ([scriptblock]::Create($prefix+$body))
  $script:Loaded.Add([pscustomobject]@{source=$SourcePath;name=$name;knownOldAssignmentMutated=($LegacyAssignment-and$name-eq'Restore-PreservedState');sourceStartLine=$f.Extent.StartLineNumber;sourceEndLine=$f.Extent.EndLineNumber})
 }
}
function Reset-Case {$script:Copies.Clear();$script:Events.Clear();$script:Guards.Clear();$script:CopyExit=0;$script:Maintenance='owned';$global:Error.Clear()}
function Read-SyntheticState {
 return [pscustomobject]@{
  services=@([pscustomobject]@{name='EgoistShieldCore';wasRunning=$true;startMode='Auto'})
  criticalDns=@();zapretProfile='';wrapperMigrationPending=$false;handoffStarted=$true;runAfter=$false
  userState=@(
   [pscustomobject]@{source=(Join-Path $script:Root 'not-restored-public-state.json');backupName='not-captured-0.json';sha256=('0'*64)},
   [pscustomobject]@{source=(Join-Path $script:Root 'not-restored-public-state.bak');backupName='not-captured-1.json';sha256=('0'*64)}
  )
 }
}
function Count-Error {return @($global:Error|Where-Object{$_.FullyQualifiedErrorId-like'PropertyNotFoundStrict*'-and$_.Exception.Message-match'Count'})}
function Case([string]$Name,[scriptblock]$Body){
 Reset-Case
 $r=& $Body
 $script:Rows.Add([pscustomobject]@{name=$Name;passed=$true;observation=$r;copyCalls=@($script:Copies.ToArray());events=@($script:Events.ToArray());guardAdapters=@($script:Guards.ToArray())})
}
$initial=Read-SyntheticState
Require (@($initial.services).Count-eq1-and$initial.services[0].name-eq'EgoistShieldCore'-and@($initial.criticalDns).Count-eq0-and@($initial.userState).Count-eq2-and$initial.handoffStarted-eq$true-and$initial.runAfter-eq$false) 'Synthetic Core topology differs'
Load-Actual $true
Case 'RED-synthetic-Core-ordinary-restore-Count' {
 $caught=$null
 try{Restore-PreservedState -State (Read-SyntheticState)}catch{$caught=$_}
 Require ($null-ne$caught-and$caught.FullyQualifiedErrorId-like'PropertyNotFoundStrict*'-and$caught.Exception.Message-match'Count') 'Original Count refusal absent'
 Require (($caught.InvocationInfo.ScriptLineNumber-eq$script:CountLine)-and$caught.ScriptStackTrace-match'Invoke-RobocopyDirectory'-and$script:Copies.Count-eq0) 'Exact Count site or no-copy fence differs'
 return @{expectedProductionFailure=$true;message=$caught.Exception.Message;errorId=$caught.FullyQualifiedErrorId;scriptStackTrace=$caught.ScriptStackTrace;invocationSourceLine=$caught.InvocationInfo.ScriptLineNumber;sourceLine=$script:CountLine}
}
Case 'RED-synthetic-Core-recovery-restore-Count' {
 $r=Invoke-Recovery -State (Read-SyntheticState) -Reason 'synthetic-Core Count reproduction'
 $errors=@(Count-Error)
 Require ($r-eq$false-and$errors.Count-gt0-and($errors[0].InvocationInfo.ScriptLineNumber-eq$script:CountLine)-and$errors[0].ScriptStackTrace-match'Invoke-RobocopyDirectory') 'Recovery did not preserve exact Count error'
 Require ($script:Maintenance-eq'owned'-and@($script:Events|Where-Object{$_.status-eq'recovery-warning'-and$_.message-like'restore:*Count*'}).Count-gt0) 'Recovery ownership warning differs'
 return @{expectedProductionFailure=$true;recovered=$r;scriptStackTrace=$errors[0].ScriptStackTrace;invocationSourceLine=$errors[0].InvocationInfo.ScriptLineNumber;maintenanceRetained=$true}
}
Case 'RED-synthetic-Core-bounded-recovery-attempts-retains-pending' {
 $r=Invoke-InstallerRecoveryAttempts -State (Read-SyntheticState) -Reason 'synthetic-Core Count reproduction' -Attempts 2 -RetrySeconds 0
 $errors=@(Count-Error)
 Require ($r-eq$false-and$errors.Count-ge2-and$script:Maintenance-eq'owned'-and(Test-Path -LiteralPath (Join-Path $StageDirectory 'recovery-pending.json'))) 'Bounded retained recovery differs'
 return @{expectedProductionFailure=$true;recovered=$r;CountFailures=$errors.Count;pendingRetained=$true;maintenanceRetained=$true}
}
Case 'OLD-assignment-true-keeps-one-SystemDoH-exclude' {
 Restore-PreservedState -State (Read-SyntheticState) -PreserveSystemDohRuntime
 Require ($script:Copies.Count-eq1-and@($script:Copies[0].arguments|Where-Object{$_-ceq'/XD'}).Count-eq1) 'Original true exclude differs'
 Require ($script:Copies[0].arguments[-1]-eq(Join-Path $StageDirectory 'runtime-backup\SystemDoH')) 'Exact exclude path differs'
 return @{excludedCount=1;payloadContinuityAdapterCalled=$script:Guards.Contains('inert-payload-continuity')}
}
Load-Actual $false
Case 'GREEN-synthetic-Core-ordinary-restore-zero-excludes' {
 Restore-PreservedState -State (Read-SyntheticState)
 Require ($script:Copies.Count-eq1-and@($script:Copies[0].arguments|Where-Object{$_-ceq'/XD'}).Count-eq0) 'Zero exclude restore failed'
 return @{excludedCount=0;restoredUnderInertBoundaries=$true;minimalSyntheticState=$true}
}
Case 'GREEN-true-keeps-one-SystemDoH-exclude' {
 Restore-PreservedState -State (Read-SyntheticState) -PreserveSystemDohRuntime
 Require ($script:Copies.Count-eq1-and@($script:Copies[0].arguments|Where-Object{$_-ceq'/XD'}).Count-eq1-and$script:Copies[0].arguments[-1]-eq(Join-Path $StageDirectory 'runtime-backup\SystemDoH')) 'Green exact one exclude failed'
 return @{excludedCount=1;payloadContinuityAdapterCalled=$script:Guards.Contains('inert-payload-continuity')}
}
Case 'GREEN-synthetic-Core-recovery-closes-owned-inert-maintenance' {
 $r=Invoke-Recovery -State (Read-SyntheticState) -Reason 'synthetic-Core narrowed draft'
 Require ($r-eq$true-and$script:Maintenance-eq'absent'-and$script:Copies.Count-eq1-and@($script:Events|Where-Object{$_.status-eq'recovered'}).Count-eq1-and@(Count-Error).Count-eq0) 'Green recovery remained failed'
 return @{recovered=$true;inertMaintenanceClosed=$true;nativeRestorationVerified=$false}
}
Case 'GREEN-synthetic-Core-bounded-recovery-removes-own-pending' {
 $r=Invoke-InstallerRecoveryAttempts -State (Read-SyntheticState) -Reason 'synthetic-Core narrowed draft' -Attempts 2 -RetrySeconds 0
 Require ($r-eq$true-and$script:Maintenance-eq'absent'-and-not(Test-Path -LiteralPath (Join-Path $StageDirectory 'recovery-pending.json'))) 'Green bounded recovery remained pending'
 return @{recovered=$true;ownPendingRemoved=$true;nativeRestorationVerified=$false}
}
function Derived-OwnUserState {
 $s=Read-SyntheticState;$records=@();$ud=Join-Path $StageDirectory 'user-state';[void][IO.Directory]::CreateDirectory($ud)
 for($i=0;$i-lt2;$i++){
  $backup=Join-Path $ud ("derived-"+$i+".json");[IO.File]::WriteAllText($backup,('{"synthetic":true,"id":'+$i+'}'),[Text.UTF8Encoding]::new($false))
  $records+=[pscustomobject]@{source=(Join-Path $script:Root ("restored-user-state\state-"+$i+".json"));backupName=("derived-"+$i+".json");sha256=(Get-FileSha256 $backup)}
 }
 $s.userState=$records;return $s
}
Case 'GREEN-derived-own-two-user-files-checksum-and-copy' {
 $s=Derived-OwnUserState;Restore-PreservedState -State $s
 foreach($r in $s.userState){Require ((Get-FileSha256 $r.source)-eq$r.sha256) 'Own user bytes changed'}
 return @{minimalSyntheticState=$false;derivedOwnUserFiles=2;actualOwnFileHashesVerified=$true}
}
Case 'GREEN-derived-corrupt-user-backup-refused' {
 $s=Derived-OwnUserState;$s.userState[0].sha256='0'*64;$caught=$null
 try{Restore-PreservedState -State $s}catch{$caught=$_}
 Require ($null-ne$caught-and$caught.Exception.Message-match'Preserved user-state file failed checksum validation') 'Checksum guard weakened'
 return @{minimalSyntheticState=$false;guardRefusal=$caught.Exception.Message}
}
Case 'GREEN-robocopy-exit8-still-refused' {
 $script:CopyExit=8;$caught=$null
 try{Restore-PreservedState -State (Read-SyntheticState)}catch{$caught=$_}
 Require ($null-ne$caught-and$caught.Exception.Message-match'Robocopy failed with exit code 8') 'Copy error refusal weakened'
 return @{guardRefusal=$caught.Exception.Message}
}
Case 'GREEN-foreign-maintenance-still-refused-before-copy' {
 $script:Maintenance='foreign';$caught=$null
 try{Invoke-Recovery -State (Read-SyntheticState) -Reason 'foreign fixture'}catch{$caught=$_}
 Require ($null-ne$caught-and$caught.Exception.Message-match'Another service maintenance stage'-and$script:Copies.Count-eq0) 'Maintenance ownership refusal weakened'
 return @{guardRefusal=$caught.Exception.Message;copyCalls=0}
}
Case 'UNCHANGED-callee-omitted-argument-default-is-empty-array' {
 Invoke-RobocopyDirectory -Source (Join-Path $StageDirectory 'runtime-backup') -Destination $script:RuntimeRoot
 Require ($script:Copies.Count-eq1-and@($script:Copies[0].arguments|Where-Object{$_-ceq'/XD'}).Count-eq0) 'Existing omitted default changed'
 return @{excludedCount=0;defaultPreserved=$true}
}
Case 'UNCHANGED-callee-explicit-null-reproduces-overridden-default' {
 $caught=$null
 try{Invoke-RobocopyDirectory -Source (Join-Path $StageDirectory 'runtime-backup') -Destination $script:RuntimeRoot -ExcludeDirectories $null}catch{$caught=$_}
 Require ($null-ne$caught-and$caught.Exception.Message-match'Count'-and($caught.InvocationInfo.ScriptLineNumber-eq$script:CountLine)-and$caught.ScriptStackTrace-match'Invoke-RobocopyDirectory'-and$script:Copies.Count-eq0) 'Caller-null distinction absent'
 return @{errorId=$caught.FullyQualifiedErrorId;scriptStackTrace=$caught.ScriptStackTrace;invocationSourceLine=$caught.InvocationInfo.ScriptLineNumber;calleeUnchanged=$true;explicitNullIsNotOmitted=$true}
}
$proof=[ordered]@{
 schemaVersion=1;kind='actual-AST-preserved-runtime-restore-regression';powershellVersion=$PSVersionTable.PSVersion.ToString()
 sourceSha256=(Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
 cases=$script:Rows.Count;passed=$script:Rows.Count;fail=0;rows=@($script:Rows.ToArray());actualImports=@($script:Loaded.ToArray())
 nativeOperations=0;installedPrivateReads=0;guiOperations=0;networkOperations=0;sourceSharedEdits=0;realRobocopyExecuted=$false;fullWorkerRun=$false
 adapters='Current AST; only known old exclude assignment mutated in memory for RED. Minimal synthetic Core state; native leaves inert. Own synthetic file copy/hash checks separately labeled.'
}
[IO.File]::WriteAllText((Join-Path $script:Root 'proof.json'),($proof|ConvertTo-Json -Depth 12)+[char]10,[Text.UTF8Encoding]::new($false))
$proof|ConvertTo-Json -Depth 12
