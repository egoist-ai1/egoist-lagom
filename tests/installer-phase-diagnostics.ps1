param(
  [Parameter(Mandatory=$true)][string]$TestDirectory,
  [string]$SourcePath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$unicodeMarker=-join ([char[]]@(0x041F,0x0440,0x043E,0x0432,0x0435,0x0440,0x043A,0x0430))
if (-not $SourcePath) { $SourcePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1' }
function Require([bool]$Value,[string]$Message) { if(-not $Value){throw $Message} }
$root = [IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
Require ((Split-Path -Leaf $root) -like 'lagom-phase-diagnostics-*') 'Use the caller-created diagnostics fixture directory.'
$item = Get-Item -LiteralPath $root -Force -ErrorAction Stop
Require ($item.PSIsContainer -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'Fixture root must be an ordinary directory.'
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$parseErrors)
Require ($parseErrors.Count -eq 0) 'Production cleanup does not parse in Windows PowerShell 5.1.'
$functions=@{}
foreach($fn in @($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true))){$functions[$fn.Name]=$fn.Extent.Text}
$helperAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\service-maintenance.ps1'),[ref]$tokens,[ref]$parseErrors)
Require ($parseErrors.Count -eq 0) 'Shared diagnostic helpers do not parse in Windows PowerShell 5.1.'
foreach($fn in @($helperAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in @('ConvertTo-InstallerDiagnosticMessage','New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic')},$true))){$functions[$fn.Name]=$fn.Extent.Text}
# Extract the actual dispatcher AST, never evaluate installer initialization.
# A legacy source input reproduces RED through real if/switch execution.
$tries=@($ast.EndBlock.Statements|Where-Object {
  $_ -is [Management.Automation.Language.TryStatementAst] -and @($_.Body.Statements|Where-Object {$_ -is [Management.Automation.Language.SwitchStatementAst] -and $_.Condition.Extent.Text -eq '$Phase'}).Count -eq 1
})
if($tries.Count -eq 1){$dispatch=$tries[0].Extent.Text;$mode='production try/catch AST'}
else {
  $switches=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.SwitchStatementAst] -and $_.Condition.Extent.Text -eq '$Phase'})
  Require ($switches.Count -eq 1) 'Missing production phase switch AST.'
  $repair=@($ast.EndBlock.Statements|Where-Object {
    $_ -is [Management.Automation.Language.IfStatementAst] -and $_.Extent.EndOffset -le $switches[0].Extent.StartOffset -and
    $null -ne $_.Find({param($n)$n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Repair-UpgradeStateAccess'},$true)
  })
  Require ($repair.Count -eq 1) 'Missing legacy production repair gate AST.'
  $dispatch=$repair[0].Extent.Text+"`r`n"+$switches[0].Extent.Text;$mode='legacy production if/switch AST'
}
$definitions=New-Object 'Collections.Generic.List[string]'
# Fail closed at every unselected production function.
foreach($name in $functions.Keys){$definitions.Add(('function {0} {{ throw ''Forbidden unselected production boundary: {0}'' }}' -f $name))}
foreach($name in @('Write-Journal','ConvertTo-InstallerDiagnosticMessage','New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic','Write-InstallerPhaseFailure','Invoke-ProtectedSystemDohContinuityProbe','Test-InstallMayStopOwnedRuntimes','Stop-AllOwnedRuntimes','Stop-OwnedService','Restore-OwnedServiceRegistrations','ConvertFrom-JsonCollectionCompat')){
  if($functions.ContainsKey($name)){$definitions.Add($functions[$name])}
  elseif($name -notin @('ConvertTo-InstallerDiagnosticMessage','Write-InstallerPhaseFailure')){throw ('Missing production function '+$name)}
}
$workerAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1'),[ref]$tokens,[ref]$parseErrors)
Require ($parseErrors.Count -eq 0) 'Protected worker does not parse in Windows PowerShell 5.1.'
$probeDispatch=@($workerAst.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.IfStatementAst] -and $_.Clauses[0].Item1.Extent.Text -eq '$ProbePayloadContinuity'})
Require ($probeDispatch.Count -eq 1) 'Missing actual readonly worker probe dispatcher AST.'
$workerFunctions=@{}
foreach($fn in @($workerAst.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst]},$true))){$workerFunctions[$fn.Name]=$fn.Extent.Text}
$probeHelpers=(@('ConvertTo-InstallerDiagnosticMessage','New-InstallerFailureDiagnostic','Read-InstallerFailureDiagnostic')|ForEach-Object{$functions[$_]}) -join "`r`n"
$probeHeader=@'
param([switch]$ProbePayloadContinuity,[string]$StageDirectory)
$ErrorActionPreference='Stop'
$probeRoot=[IO.Path]::GetFullPath($StageDirectory)
function Resolve-FullPath {param($Path,[switch]$MustExist) if([IO.Path]::GetFullPath($Path) -ne $probeRoot){throw 'Forbidden probe path'};return $probeRoot}
function Get-FixtureProbeFailure {$marker=-join ([char[]]@(0x041F,0x0440,0x043E,0x0432,0x0435,0x0440,0x043A,0x0430));throw [InvalidOperationException]::new("Fixture diagnostic failure at Assert-InstalledCandidateRuntime; $marker; https://private.example.invalid/dns-query?token=url-secret`r`nAuthorization: Bearer header-secret`nCookie: sid=cookie-secret`npassword=assignment-secret; {`"apiKey`":`"json-secret`"} "+('Q'*3000))}
function Test-IsAdministrator {Get-FixtureProbeFailure}
function Get-SystemDohRecoveryFiles {param($State) Get-FixtureProbeFailure}
function Assert-InstallerMaintenanceBootRecovery {throw 'Forbidden boot receipt access'}
function Get-ValidatedMaintenanceRecoveryState {throw 'Forbidden recovery snapshot access'}
function Get-CimInstance {throw 'Forbidden native CIM'}
function Start-Service {throw 'Forbidden native SCM'}
function Set-DnsClientServerAddress {throw 'Forbidden native DNS'}
function reg.exe {throw 'Forbidden native registry'}
'@
$probeCachedFailure=@'
function Invoke-PayloadContinuityProbe {
  $script:PayloadContinuityDiagnosticSubstage='runtime-proof'
  $result=Test-OwnedSystemDohRecoveryRuntime -State ([pscustomobject]@{}) -PreservedRuntimeRecovery -AsEvidence
  [IO.File]::WriteAllText((Join-Path $StageDirectory 'proof-boolean.txt'),[string]$result)
  if($result -ne $false){throw 'Fixture expected unchanged false proof result'}
  throw 'Readonly probe retained its failed proof result.'
}
'@
$header=@'
param([string]$CaseRoot)
$ErrorActionPreference='Continue'
$script:fixtureRoot=[IO.Path]::GetFullPath($CaseRoot).TrimEnd('\')
$env:TEMP=$fixtureRoot;$env:TMP=$fixtureRoot
$script:cfg=[IO.File]::ReadAllText((Join-Path $fixtureRoot 'case.json'))|ConvertFrom-Json
$script:tracePath=Join-Path $fixtureRoot 'trace.jsonl'
$Phase=[string]$cfg.phase;$installRoot=Join-Path $fixtureRoot 'install'
$Services=@();$GuardPid=0;$GuardStopFile='';$GuardMaxSeconds=1
$upgradeStateDirectory=Join-Path $fixtureRoot 'state'
if($cfg.journalUnavailable){$upgradeStateDirectory=Join-Path $fixtureRoot 'unavailable-state'}
$upgradeJournalPath=Join-Path $upgradeStateDirectory 'upgrade-journal.json'
$upgradeMarkerPath=Join-Path $upgradeStateDirectory 'marker.txt'
$serviceBackupDirectory=Join-Path $fixtureRoot 'service-backup'
$serviceBackupManifestPath=Join-Path $serviceBackupDirectory 'manifest.json'
$ownedServices=@('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldVpn')
$legacyOwnedServices=@();$sharedNameServices=@();$ownedProcesses=@();$sharedNameProcesses=@()
# Child environment only. No stage, authorization, service, or network is made.
$env:EGOIST_PROTECTED_REINSTALL_STAGE=''
$env:EGOISTSHIELD_INSTALLER_TEST_REGISTRY_ROOT=''
$env:EGOISTSHIELD_INSTALLER_STATE_DIR=''
$env:EGOISTSHIELD_INSTALLER_TEST_DISABLE_RUNTIME_CLEANUP=''
'@
$boundaries=@'
function Trace([string]$Name,$Data=$null){
  [IO.File]::AppendAllText($tracePath,(([ordered]@{name=$Name;data=$Data}|ConvertTo-Json -Compress -Depth 8)+"`r`n"),[Text.UTF8Encoding]::new($false))
}
function Assert-FixturePath([string]$Path){
  if(-not $Path -or $Path -match '^(Registry:|HK[A-Z0-9]*:)' -or -not [IO.Path]::GetFullPath($Path).StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Forbidden filesystem or registry boundary.'}
}
function Inject-Failure([string]$Name){
  Trace $Name
  if($cfg.failAt -eq $Name){
    if($cfg.probeMode){[void](Invoke-ProtectedSystemDohContinuityProbe -Stage (Join-Path $fixtureRoot 'probe-boundary'));return}
    $marker=-join ([char[]]@(0x041F,0x0440,0x043E,0x0432,0x0435,0x0440,0x043A,0x0430))
    $message="Fixture diagnostic failure at $Name; $marker; https://private.example.invalid/dns-query?token=url-secret`r`nAuthorization: Bearer header-secret`nCookie: sid=cookie-secret`npassword=assignment-secret; {`"apiKey`":`"json-secret`"} "+('Q'*3000)
    if($cfg.longErrorId){Write-Error -Exception ([InvalidOperationException]::new($message)) -ErrorId ('fixture.error.'+('E'*400)) -ErrorAction Stop}
    throw [InvalidOperationException]::new($message)
  }
}
# Only scoped fixture reads and real journal writes can reach filesystem cmdlets.
function New-Item {[CmdletBinding()]param([string]$ItemType,[string]$Path,[switch]$Force) Assert-FixturePath $Path;Microsoft.PowerShell.Management\New-Item @PSBoundParameters}
function Add-Content {[CmdletBinding()]param([string]$LiteralPath,[string]$Encoding,[Parameter(ValueFromPipeline=$true)]$Value) process{Assert-FixturePath $LiteralPath;Microsoft.PowerShell.Management\Add-Content @PSBoundParameters}}
function Get-Content {[CmdletBinding()]param([string]$LiteralPath,[switch]$Raw) Assert-FixturePath $LiteralPath;Microsoft.PowerShell.Management\Get-Content @PSBoundParameters}
function Test-Path {[CmdletBinding()]param([string]$LiteralPath,[string]$Path,[string]$PathType) $candidate=if($LiteralPath){$LiteralPath}else{$Path};Assert-FixturePath $candidate;Microsoft.PowerShell.Management\Test-Path @PSBoundParameters}
function Remove-Item {[CmdletBinding()]param([string]$LiteralPath,[switch]$Recurse,[switch]$Force) Assert-FixturePath $LiteralPath;Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters}
# These blockers are in place before any production dispatcher is evaluated.
foreach($name in @('Get-CimInstance','Invoke-CimMethod','Get-WmiObject','Get-NetAdapter','Get-DnsClientServerAddress','Set-DnsClientServerAddress','Resolve-DnsName','Start-Process','Stop-Process','Start-Service','Stop-Service','Set-Service','Restart-Service','New-ItemProperty','Set-ItemProperty','Remove-ItemProperty','Get-ItemProperty','Register-ScheduledTask','Unregister-ScheduledTask','Remove-NetFirewallRule','Set-NetIPInterface','ipconfig.exe','netsh.exe','schtasks.exe','taskkill.exe','sc.exe')){
  Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create(('Trace ''native:{0}'';throw ''Forbidden native boundary: {0}''' -f $name)))
}
function reg.exe {Trace 'simulated:reg-import' @($args);$global:LASTEXITCODE=0}
function Invoke-CheckedExternal {param($FilePath,$Arguments,$Stage,$AllowedExitCodes) Trace 'simulated:SCM' @{stage=$Stage;arguments=@($Arguments)};return 0}
function Test-CanonicalInstallerTarget {param($Root) Trace 'canonical-target';return [bool]$cfg.canonical}
function Test-EmptyPlainDirectory {param($Root) return (-not [bool]$cfg.existing)}
function Test-VerifiedCanonicalInstalledApplication {param($Root) Trace 'installed-identity';return [bool]$cfg.identity}
function Test-VerifiedProtectedReinstall {Trace 'protected-proof';return [bool]$cfg.protected}
function Test-RunningOwnedSystemDoh {Trace 'running-doh';return [bool]$cfg.runningDoh}
function Get-CriticalLoopbackDnsInterfaces {Trace 'critical-dns';if($cfg.criticalDns){return [pscustomobject]@{interfaceIndex=7;interfaceAlias='Fixture adapter'}};return @()}
function Test-InstallRootUnderProgramFiles {param($Root) return [bool]$cfg.validRoot}
function Test-InstallRootHealthy {param($Root) return [bool]$cfg.healthy}
function Repair-UpgradeStateAccess {Inject-Failure 'Repair-UpgradeStateAccess'}
function Get-InstallerBootRecoveryContext {param($Stage,[switch]$AllowLegacyInventory) Assert-FixturePath $Stage;return [pscustomobject]@{powerShell=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')}}
function Get-ValidatedUpgradeQuarantine {if($cfg.pending){return (Join-Path $fixtureRoot 'pending')};return $null}
function Get-CommittedUpgradeQuarantine {return $null}
function Restore-UpgradeQuarantine {param([switch]$SkipRuntimeCleanup) Trace 'Restore-UpgradeQuarantine';return [string]$cfg.restoreStatus}
function Wait-OwnedFilesReleased {param($Seconds) Trace 'Wait-OwnedFilesReleased';return [bool]$cfg.released}
function Get-RunningOwnedServiceNames {Trace 'Get-RunningOwnedServiceNames';return @('EgoistShieldCore')}
function Get-ProtectedSystemDohPayloadContinuity {if($cfg.continuity){return [pscustomobject]@{proof=[pscustomobject]@{wrapperPid=101;enginePid=102}}};return $null}
function Backup-OwnedServiceRegistrations {
  param($Names)
  Inject-Failure 'Backup-OwnedServiceRegistrations'
  [void][IO.Directory]::CreateDirectory($serviceBackupDirectory)
  [IO.File]::WriteAllText($serviceBackupManifestPath,(ConvertTo-Json -InputObject @($cfg.records) -Depth 8),[Text.UTF8Encoding]::new($false))
}
function Suspend-InstallerServiceRestarts {param($Records,$SnapshotPath,$OwnPath,$StopCore) Trace 'suspend-records' @($Records|Select-Object name,startMode,wasRunning)}
function Restore-InstallerServiceStartModes {param($Records,$OwnPath) Trace 'restore-modes' @($Records|Select-Object name,startMode,wasRunning)}
function Get-ServiceImagePath {param($Name) if($cfg.phase -eq 'StartServices'){return $null};return (Join-Path $fixtureRoot 'service.exe')}
function Get-ExecutableFromCommandLine {param($CommandLine) return [string]$CommandLine}
function Test-OwnedPath {param($Path) Assert-FixturePath $Path;return $true}
function Test-ExclusiveOwnedServiceName {param($Name) return $Name -like 'EgoistShield*'}
function Stop-InstallerOwnedService {param($Name,$OwnPath) Trace ('simulated:stop:'+$Name)}
function Get-Service {param($Name,$ErrorAction) return $null}
function Start-Sleep {param($Milliseconds,$Seconds)}
function Enter-UninstallMaintenanceLease {throw 'Fixture protected update is busy.'}
function New-UpgradeQuarantine {Inject-Failure 'New-UpgradeQuarantine';if($cfg.quarantineLocked){throw 'INSTALL_ROOT_LOCKED: controlled sharing violation'}}
foreach($name in @('Reconcile-OrphanedExternalBaseline','Save-SystemNetworkBaseline','Backup-AndResetPersistedNetworkActivation','Invoke-CoreOwnedDnsCleanup','Unload-OwnedWinDivertDriver','Invoke-CoreServiceOfflineRecovery','Remove-IncompatibleOwnedServices','New-OwnedRuntimeQuarantine','Reset-WindowsNetworkBaseline','Remove-OwnedFirewallRules','Remove-OwnedShortcuts','Remove-OrphanedOwnedServices','Backup-OwnedInstallRegistration','Remove-OwnedInstallRegistrationBackup','Remove-OwnedInstallRegistration','Complete-UpgradeQuarantine','Suspend-OwnedGuiLoginStartup','Stop-AllServicesFromOwnedRoots','Stop-AllProcessesFromOwnedRoots','Update-ShellIconCache','Assert-InstalledCandidateRuntime')){
  Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create(('Inject-Failure ''{0}''' -f $name)))
}
'@
$script:caseCount=0
function New-Config([string]$Phase,[hashtable]$Change=@{}){
  $cfg=@{phase=$Phase;canonical=$true;existing=$false;identity=$true;protected=$false;runningDoh=$false;criticalDns=$false;validRoot=$true;healthy=$false;pending=$false;restoreStatus='restored';released=$true;continuity=$false;journalUnavailable=$false;longErrorId=$false;failAt='';quarantineLocked=$false;probeMode='';expectedSubstage='phase-dispatch';records=@()}
  foreach($key in $Change.Keys){$cfg[$key]=$Change[$key]};return $cfg
}
function Invoke-Case([string]$Name,[hashtable]$Config,[int]$ExpectedExit,[bool]$Failure=$false){
  $caseRoot=Join-Path $root $Name
  [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot 'install'))
  [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot 'pending'))
  [IO.File]::WriteAllText((Join-Path $caseRoot 'case.json'),($Config|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  if($Config.journalUnavailable){[IO.File]::WriteAllText((Join-Path $caseRoot 'unavailable-state'),'controlled journal failure')}
  if($Config.phase -eq 'StartServices'){
    $backup=Join-Path $caseRoot 'service-backup';[void][IO.Directory]::CreateDirectory($backup)
    [IO.File]::WriteAllText((Join-Path $backup 'manifest.json'),(ConvertTo-Json -InputObject @($Config.records) -Depth 8),[Text.UTF8Encoding]::new($false))
  }
  if($Config.probeMode){
    $probeRoot=Join-Path $caseRoot 'probe-boundary';[void][IO.Directory]::CreateDirectory($probeRoot)
    $probeBody=$probeHeader+"`r`n"+$probeHelpers+"`r`n"+$workerFunctions['Test-OwnedSystemDohRecoveryRuntime']+"`r`n"+$workerFunctions['Invoke-PayloadContinuityProbe']
    if($Config.probeMode -eq 'cached-proof'){$probeBody+="`r`n"+$probeCachedFailure}
    [IO.File]::WriteAllText((Join-Path $probeRoot 'invoke-final-silent-reinstall.ps1'),($probeBody+"`r`n"+$probeDispatch[0].Extent.Text),[Text.UTF8Encoding]::new($true))
  }
  $scriptPath=Join-Path $caseRoot 'dispatch.ps1'
  [IO.File]::WriteAllText($scriptPath,($header+"`r`n"+($definitions -join "`r`n")+"`r`n"+$boundaries+"`r`n"+$dispatch),[Text.UTF8Encoding]::new($true))
  $start=New-Object Diagnostics.ProcessStartInfo
  $start.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptPath+'" -CaseRoot "'+$caseRoot+'"'
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.StandardOutputEncoding=[Text.Encoding]::UTF8;$start.StandardErrorEncoding=[Text.Encoding]::UTF8
  $process=New-Object Diagnostics.Process;$process.StartInfo=$start
  try{
    Require ($process.Start()) ($Name+': dispatcher did not start.')
    $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(15000)){$process.Kill();throw ($Name+': dispatcher exceeded deadline.')}
    $stdout=$out.Result;$stderr=$err.Result;$exitCode=$process.ExitCode
  }finally{$process.Dispose()}
  [IO.File]::WriteAllText((Join-Path $caseRoot 'stdout.txt'),$stdout)
  [IO.File]::WriteAllText((Join-Path $caseRoot 'stderr.txt'),$stderr)
  Require ($exitCode -eq $ExpectedExit) ($Name+': expected exit '+$ExpectedExit+' observed '+$exitCode+'; '+$stderr)
  Require ($stderr -notmatch 'private\.example|url-secret|header-secret|cookie-secret|assignment-secret|json-secret') ($Name+': stderr leaked a private URL or credential.')
  $traceFile=Join-Path $caseRoot 'trace.jsonl'
  $trace=@(if(Test-Path -LiteralPath $traceFile){Get-Content -LiteralPath $traceFile|ForEach-Object{$_|ConvertFrom-Json}})
  Require (@($trace|Where-Object{$_.name -like 'native:*'}).Count -eq 0) ($Name+': reached a native boundary.')
  $journalFile=Join-Path $caseRoot 'state\upgrade-journal.json'
  $journal=@(if(Test-Path -LiteralPath $journalFile){Get-Content -LiteralPath $journalFile|ForEach-Object{$_|ConvertFrom-Json}})
  $failed=@($journal|Where-Object{$_.stage -eq 'phase-failed'})
  $expectedEvents=if($Config.journalUnavailable -or $ExpectedExit -eq 0){0}else{1}
  Require ($failed.Count -eq $expectedEvents) ($Name+': expected '+$expectedEvents+' persisted phase-failed event, observed '+$failed.Count+' ('+$mode+').')
  if($failed.Count){
    Require ([int]$failed[0].exitCode -eq $ExpectedExit) ($Name+': diagnostic changed the original numeric status.')
    Require ($failed[0].phase -eq $Config.phase -and $failed[0].installRoot -eq (Join-Path $caseRoot 'install')) ($Name+': diagnostic phase or target changed.')
  }
  if($Failure){
    $event=$failed[0]
    Require ($event.exceptionType -eq 'System.InvalidOperationException') ($Name+': original exception type lost.')
    Require ($event.line -is [int] -and $event.line -gt 0) ($Name+': original invocation line lost.')
    Require ($event.errorMessage -like ('Fixture diagnostic failure at '+$Config.failAt+'*')) ($Name+': safe failure context lost.')
    Require ($event.errorMessage.Contains($unicodeMarker)) ($Name+': Cyrillic diagnostic marker did not survive the native UTF8 transport.')
    Require ($event.errorMessage.Length -le 2048 -and $event.errorId.Length -le 256 -and $event.exceptionType.Length -le 256) ($Name+': unbounded diagnostic.')
    Require (@($event.PSObject.Properties.Name).Count -eq 10 -and $event.substage -eq $Config.expectedSubstage) ($Name+': unexpected raw diagnostic fields or substage.')
    $json=$event|ConvertTo-Json -Compress
    Require ($json -notmatch 'https://|private\.example|url-secret|header-secret|cookie-secret|assignment-secret|json-secret') ($Name+': journal leaked a private URL or credential.')
    Require ($event.errorMessage -notmatch '[\r\n]') ($Name+': multiline diagnostic.')
  }
  $script:caseCount++
  return [pscustomobject]@{trace=$trace;journal=$journal;stdout=$stdout;stderr=$stderr;root=$caseRoot}
}
function Require-NoMutation($Case,[string]$Name){
  $mutations=@($Case.trace|Where-Object{$_.name -in @('Backup-OwnedServiceRegistrations','Save-SystemNetworkBaseline','Backup-AndResetPersistedNetworkActivation','Suspend-OwnedGuiLoginStartup','suspend-records','Restore-UpgradeQuarantine') -or $_.name -like 'simulated:*'})
  Require ($mutations.Count -eq 0) ($Name+': guard reached a mutation boundary.')
}
[void](Invoke-Case 'repair-throw' (New-Config 'PreInstall' @{failAt='Repair-UpgradeStateAccess'}) 1 $true)
[void](Invoke-Case 'snapshot-throw' (New-Config 'PreInstall' @{failAt='Save-SystemNetworkBaseline';longErrorId=$true}) 1 $true)
[void](Invoke-Case 'verify-throw' (New-Config 'VerifyInstall' @{failAt='Assert-InstalledCandidateRuntime'}) 1 $true)
[void](Invoke-Case 'journal-unavailable' (New-Config 'PreInstall' @{failAt='Repair-UpgradeStateAccess';journalUnavailable=$true}) 1)
[void](Invoke-Case 'explicit-journal-unavailable45' (New-Config 'PreInstall' @{validRoot=$false;journalUnavailable=$true}) 45)
Write-Output 'PASS: thrown repair and phase failures persist bounded private-safe diagnostics; journal failure retains exit 1'
foreach($case in @(
  @{name='handoff54';phase='CheckInstallSafety';change=@{existing=$true};exit=54},
  @{name='foreign58';phase='CheckInstallSafety';change=@{canonical=$false};exit=58},
  @{name='invalid-root45';phase='PreInstall';change=@{validRoot=$false};exit=45},
  @{name='preinstall54';phase='PreInstall';change=@{existing=$true};exit=54},
  @{name='freefiles54';phase='FreeFiles';change=@{existing=$true};exit=54},
  @{name='dns-check58';phase='CheckInstallSafety';change=@{runningDoh=$true;criticalDns=$true};exit=58}
)){
  $result=Invoke-Case $case.name (New-Config $case.phase $case.change) $case.exit
  Require-NoMutation $result $case.name
}
Write-Output 'PASS: canonical target, protected handoff and sole-loopback DNS guards refuse before mutation with exits 45/54/58'
foreach($case in @(
  @{name='files32';phase='PreInstall';change=@{released=$false};exit=32},
  @{name='pending43';phase='PreInstall';change=@{existing=$true;protected=$true;pending=$true;restoreStatus='deferred'};exit=43},
  @{name='locked53';phase='PreInstall';change=@{quarantineLocked=$true};exit=53},
  @{name='rollback41';phase='PostInstall';change=@{restoreStatus='restored'};exit=41},
  @{name='rollback42';phase='PostInstall';change=@{restoreStatus='deferred'};exit=42},
  @{name='rollback-deferred42';phase='RollbackUpgrade';change=@{restoreStatus='deferred'};exit=42},
  @{name='registration46';phase='RegistrationSelfTest';change=@{};exit=46},
  @{name='quarantine51';phase='QuarantineRetrySelfTest';change=@{};exit=51},
  @{name='uninstall59';phase='Uninstall';change=@{};exit=59}
)){[void](Invoke-Case $case.name (New-Config $case.phase $case.change) $case.exit)}
Write-Output 'PASS: explicit production exits 32/41/42/43/46/51/53/59 retain their numeric status'
$manual=Invoke-Case 'manual-off-safe' (New-Config 'CheckInstallSafety') 0
Require-NoMutation $manual 'manual-off-safe'
$continuity=Invoke-Case 'private-continuity-stop' (New-Config 'FreeFiles' @{existing=$true;protected=$true;continuity=$true;records=@([pscustomobject]@{name='EgoistShieldCore';startMode='Auto';wasRunning=$true},[pscustomobject]@{name='EgoistShieldSystemDoH';startMode='Auto';wasRunning=$true})}) 0
$suspended=@($continuity.trace|Where-Object{$_.name -eq 'suspend-records'})
Require ($suspended.Count -eq 1 -and @($suspended[0].data).Count -eq 1 -and $suspended[0].data[0].name -eq 'EgoistShieldCore') 'Private continuity entered restart suspension.'
Require (@($continuity.trace|Where-Object{$_.name -eq 'simulated:stop:EgoistShieldSystemDoH'}).Count -eq 0 -and @($continuity.trace|Where-Object{$_.name -eq 'simulated:stop:EgoistShieldCore'}).Count -eq 1) 'Private continuity changed the stopped service set.'
$records=@(
  [pscustomobject]@{name='EgoistShieldCore';fileName='service-0.reg';pathName=(Join-Path $root 'core.exe');displayName='Core';startMode='Auto';wasRunning=$true},
  [pscustomobject]@{name='EgoistShieldSystemDoH';fileName='service-1.reg';pathName=(Join-Path $root 'doh.exe');displayName='DoH';startMode='Manual';wasRunning=$false},
  [pscustomobject]@{name='EgoistShieldVpn';fileName='service-2.reg';pathName=(Join-Path $root 'vpn.exe');displayName='VPN';startMode='Disabled';wasRunning=$true}
)
$off=Invoke-Case 'manual-off-restore' (New-Config 'StartServices' @{records=$records}) 0
$starts=@($off.trace|Where-Object{$_.name -eq 'simulated:SCM' -and $_.data.arguments[0] -eq 'start'})
Require ($starts.Count -eq 1 -and $starts[0].data.arguments[1] -eq 'EgoistShieldCore') 'Manual/off service intent was promoted.'
$creates=@($off.trace|Where-Object{$_.name -eq 'simulated:SCM' -and $_.data.arguments[0] -eq 'create'})
Require (@($creates|Where-Object{$_.data.arguments[1] -eq 'EgoistShieldSystemDoH' -and $_.data.arguments[5] -eq 'demand'}).Count -eq 1) 'Manual demand-start mode changed.'
Require (@($creates|Where-Object{$_.data.arguments[1] -eq 'EgoistShieldVpn' -and $_.data.arguments[5] -eq 'disabled'}).Count -eq 1) 'Disabled mode changed.'
$private=Invoke-Case 'private-continuity-restore' (New-Config 'StartServices' @{records=$records;continuity=$true}) 0
Require (@($private.trace|Where-Object{$_.name -eq 'simulated:SCM' -and $_.data.arguments[1] -eq 'EgoistShieldSystemDoH'}).Count -eq 0) 'Private continuity service was recreated or restarted.'
$modes=@($private.trace|Where-Object{$_.name -eq 'restore-modes'})
Require ($modes.Count -eq 1 -and @($modes[0].data|Where-Object{$_.name -eq 'EgoistShieldSystemDoH'}).Count -eq 0) 'Private continuity mode was overwritten.'
Write-Output 'PASS: actual stop/restore branches retain private continuity, Manual demand-start and Disabled/off intent'
[void](Invoke-Case 'probe-console-failure' (New-Config 'VerifyInstall' @{failAt='Assert-InstalledCandidateRuntime';probeMode='direct';expectedSubstage='privileged-token'}) 1 $true)
$cached=Invoke-Case 'probe-cached-proof-failure' (New-Config 'VerifyInstall' @{failAt='Assert-InstalledCandidateRuntime';probeMode='cached-proof';expectedSubstage='recovery-files'}) 1 $true
Require ([IO.File]::ReadAllText((Join-Path $cached.root 'probe-boundary\proof-boolean.txt')) -eq 'False') 'Diagnostic addition changed the swallowed proof failure boolean.'
# Read the actual probe's console streams independently too: the caller refusal
# alone would not prove that the worker retained its exact exit code 2.
$probeRoot=Join-Path $cached.root 'probe-boundary'
$probeStart=New-Object Diagnostics.ProcessStartInfo
$probeStart.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$probeStart.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $probeRoot 'invoke-final-silent-reinstall.ps1')+'" -ProbePayloadContinuity -StageDirectory "'+$probeRoot+'"'
$probeStart.UseShellExecute=$false;$probeStart.CreateNoWindow=$true;$probeStart.RedirectStandardOutput=$true;$probeStart.RedirectStandardError=$true
$probeStart.StandardOutputEncoding=[Text.Encoding]::UTF8;$probeStart.StandardErrorEncoding=[Text.Encoding]::UTF8
$probeProcess=New-Object Diagnostics.Process;$probeProcess.StartInfo=$probeStart
try{
  Require ($probeProcess.Start()) 'Readonly fixture probe failed to start.'
  $probeOut=$probeProcess.StandardOutput.ReadToEndAsync();$probeErr=$probeProcess.StandardError.ReadToEndAsync()
  if(-not $probeProcess.WaitForExit(15000)){$probeProcess.Kill();throw 'Readonly fixture probe exceeded its deadline.'}
  Require ($probeProcess.ExitCode -eq 2) 'Readonly worker probe changed original exit code 2.'
  $probeStdout=$probeOut.Result;$probeStderr=$probeErr.Result
}finally{$probeProcess.Dispose()}
Require ([string]::IsNullOrWhiteSpace($probeStdout)) 'Failed probe produced a proof on stdout.'
Require ([Text.Encoding]::UTF8.GetByteCount($probeStderr) -le 8192) 'Readonly probe console diagnostic exceeded its transport bound.'
Require ($probeStderr -notmatch 'private\.example|url-secret|header-secret|cookie-secret|assignment-secret|json-secret') 'Readonly probe Console.Error leaked a private URL or credential.'
foreach($name in @('ConvertTo-InstallerDiagnosticMessage','Read-InstallerFailureDiagnostic')){. ([scriptblock]::Create($functions[$name]))}
$actualConsoleRecord=Read-InstallerFailureDiagnostic $probeStderr
Require ($null -ne $actualConsoleRecord -and $actualConsoleRecord.substage -eq 'recovery-files' -and $actualConsoleRecord.line -gt 0) 'Actual readonly probe console DTO was missing or undecodable.'
Require ($actualConsoleRecord.errorMessage.Contains($unicodeMarker)) 'Actual Console.Error did not preserve Cyrillic through native UTF8.'
$privateDto=[ordered]@{schemaVersion=1;purpose='private-dns-payload-continuity-failure';exceptionType='System.InvalidOperationException';errorId='https://private.example.invalid/token=url-secret';line=123;substage='runtime-files';errorMessage="https://private.example.invalid Authorization: Bearer header-secret`nargs=private raw invocation";rawArgs='unexpected private data'}
$decoded=Read-InstallerFailureDiagnostic ($privateDto|ConvertTo-Json -Compress)
Require ($null -ne $decoded -and @($decoded.PSObject.Properties.Name).Count -eq 7 -and ($decoded|ConvertTo-Json -Compress) -notmatch 'private\.example|header-secret|url-secret|raw invocation|rawArgs') 'Probe DTO decoder leaked or retained an unapproved field.'
Require ($null -eq (Read-InstallerFailureDiagnostic ('X'*8193))) 'Oversized probe stderr was accepted.'
$privateDto.line=-1
Require ($null -eq (Read-InstallerFailureDiagnostic ($privateDto|ConvertTo-Json -Compress))) 'Invalid probe line metadata was accepted.'
foreach($privateText in @(
  '"url":"https:\/\/private.invalid/fixture-canary"',
  '"url":"https:\u002f\u002fprivate.invalid/fixture-canary"',
  '"Authorization": "Custom fixture-canary"',
  '"Authoriz\u0061tion": "Custom fixture-canary"',
  '"argv": ["--token", "fixture-canary"]',
  '"args": "quoted\\\" fixture-canary remainder"',
  '"commandline": "program --private fixture-canary"',
  '"Authorization": "Custom\\\" fixture-canary remainder"'
)){
  $safe=ConvertTo-InstallerDiagnosticMessage ($unicodeMarker+'; '+$privateText)
  Require ($safe -notmatch 'fixture-canary|private\.invalid' -and $safe.Contains($unicodeMarker) -and $safe.Length -le 2048) 'Escaped URI or quoted/escaped authorization/invocation field survived diagnostic redaction.'
}
Write-Output 'PASS: actual readonly worker Console.Error exit 2 propagates through the real probe caller into phase diagnostics; cached failed proof remains false'
function Invoke-IsolatedScript([string]$Executable,[string]$ScriptPath,[string]$Arguments=''){
  Require ([IO.Path]::GetFullPath($ScriptPath).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'Additional fixture script escaped its owned root.'
  $start=New-Object Diagnostics.ProcessStartInfo
  $start.FileName=$Executable;$start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$ScriptPath+'" '+$Arguments
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.StandardOutputEncoding=[Text.Encoding]::UTF8;$start.StandardErrorEncoding=[Text.Encoding]::UTF8
  $process=New-Object Diagnostics.Process;$process.StartInfo=$start
  try{
    Require ($process.Start()) 'Additional fixture process failed to start.'
    $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(15000)){$process.Kill();throw 'Additional fixture process exceeded deadline.'}
    return [pscustomobject]@{code=$process.ExitCode;stdout=$out.Result;stderr=$err.Result}
  }finally{$process.Dispose()}
}
$roundtripBody=@'
$ErrorActionPreference='Stop'
$env:TEMP=$PSScriptRoot;$env:TMP=$PSScriptRoot
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$marker=-join ([char[]]@(0x041F,0x0440,0x043E,0x0432,0x0435,0x0440,0x043A,0x0430))
$failure=[Management.Automation.ErrorRecord]::new([InvalidOperationException]::new('Fixture readonly diagnostic '+$marker),'fixture.error',[Management.Automation.ErrorCategory]::InvalidOperation,$null)
$original=New-InstallerFailureDiagnostic -Failure $failure -Substage 'runtime-files'
$json=$original|ConvertTo-Json -Compress
$native=$json|ConvertFrom-Json
$decoded=Read-InstallerFailureDiagnostic $json
if(-not $decoded -or $decoded.line -ne 0 -or $decoded.substage -ne 'runtime-files'){throw 'Runtime DTO JSON roundtrip failed'}
if(-not $decoded.errorMessage.Contains($marker)){throw 'Runtime DTO Cyrillic UTF8 JSON roundtrip failed'}
if($native.line -isnot [int] -and $native.line -isnot [long]){throw 'Runtime JSON line is not an integer'}
foreach($bad in @(1.25,'1',$true,-1,100001)){
  $original.line=$bad
  if($null -ne (Read-InstallerFailureDiagnostic ($original|ConvertTo-Json -Compress))){throw 'Invalid float/string/bool/out-of-range line accepted'}
}
Write-Output ('DTO JSON roundtrip: '+$native.line.GetType().FullName+'; '+$marker+'; invalid float/string/bool/range lines refused')
'@
$roundtripPath=Join-Path $root 'dto-roundtrip.ps1'
[IO.File]::WriteAllText($roundtripPath,($probeHelpers+"`r`n"+$roundtripBody),[Text.UTF8Encoding]::new($true))
$nativePs=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$dto5=Invoke-IsolatedScript $nativePs $roundtripPath
Require ($dto5.code -eq 0 -and $dto5.stdout -like '*DTO JSON roundtrip: System.Int32*' -and $dto5.stdout.Contains($unicodeMarker)) ('WinPS5 DTO roundtrip failed: '+$dto5.stderr)
$ps7Command=Get-Command pwsh.exe -ErrorAction SilentlyContinue
if($ps7Command){
  $dto7=Invoke-IsolatedScript $ps7Command.Source $roundtripPath
  Require ($dto7.code -eq 0 -and $dto7.stdout -like '*DTO JSON roundtrip: System.Int64*' -and $dto7.stdout.Contains($unicodeMarker)) ('PS7 DTO roundtrip failed: '+$dto7.stderr)
  Write-Output 'PASS: actual PS5 Int32 and PS7 Int64 DTO JSON roundtrips; float/string/bool/out-of-range line metadata refused'
}else{Write-Output 'PASS: actual PS5 DTO JSON roundtrip; PS7 executable unavailable on this host'}
$formatFailure='function New-InstallerFailureDiagnostic { throw ''Fixture diagnostic formatter failed.'' }'
$jsonFailure='function ConvertTo-Json { throw ''Fixture diagnostic JSON writer failed.'' }'
$consoleFailure=@'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
public sealed class InstallerDiagnosticThrowingWriter : TextWriter {
  public override Encoding Encoding { get { return Encoding.UTF8; } }
  public override void WriteLine(string value) { throw new InvalidOperationException("Fixture console writer failed."); }
}
"@
[Console]::SetError([InstallerDiagnosticThrowingWriter]::new())
'@
foreach($fault in @(
  @{name='formatter';body=$formatFailure;expectDto=$true},
  @{name='json';body=$jsonFailure;expectDto=$true},
  @{name='console';body=$consoleFailure;expectDto=$false}
)){
  $faultRoot=Join-Path $root ('probe-diagnostic-fault-'+$fault.name);[void][IO.Directory]::CreateDirectory($faultRoot)
  $faultPath=Join-Path $faultRoot 'invoke-final-silent-reinstall.ps1'
  $faultHeader=$probeHeader+"`r`n"+'$env:TEMP=$probeRoot;$env:TMP=$probeRoot'
  [IO.File]::WriteAllText($faultPath,($faultHeader+"`r`n"+$probeHelpers+"`r`n"+$workerFunctions['Invoke-PayloadContinuityProbe']+"`r`n"+$fault.body+"`r`n"+$probeDispatch[0].Extent.Text),[Text.UTF8Encoding]::new($true))
  $result=Invoke-IsolatedScript $nativePs $faultPath ('-ProbePayloadContinuity -StageDirectory "'+$faultRoot+'"')
  Require ($result.code -eq 2) ($fault.name+': diagnostic failure replaced original probe exit 2: '+$result.stderr)
  Require ([string]::IsNullOrWhiteSpace($result.stdout) -and [Text.Encoding]::UTF8.GetByteCount($result.stderr) -le 8192) ($fault.name+': invalid diagnostic fallback streams.')
  Require ($result.stderr -notmatch 'private\.example|url-secret|header-secret|cookie-secret|assignment-secret|json-secret') ($fault.name+': diagnostic fallback leaked a private value.')
  if($fault.expectDto){Require ($null -ne (Read-InstallerFailureDiagnostic $result.stderr)) ($fault.name+': static fallback DTO was invalid.')}
}
Write-Output 'PASS: readonly probe retains exit 2 under actual formatter, JSON serializer and Console.Error writer exceptions'
Require ($mode -eq 'production try/catch AST') 'Passing diagnostics require the actual production dispatcher try/catch AST.'
Write-Output ('Installer phase diagnostics: 6 groups passed; '+$caseCount+' isolated WinPS5 dispatch cases; native SCM/registry/DNS/tasks/processes 0; actual temporary journal writes.')
