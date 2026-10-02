param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$fixtureRoot=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
$taskTemp=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
if (-not $fixtureRoot.StartsWith($taskTemp+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use task-owned temporary fixture files.' }
$project=Split-Path -Parent $PSScriptRoot
$cleanupPath=Join-Path $project 'src\installer\owned-cleanup.ps1'
$workerPath=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
foreach ($override in @(@('LAGOM_DNS_PAYLOAD_CLEANUP_SOURCE','cleanupPath'),@('LAGOM_DNS_PAYLOAD_WORKER_SOURCE','workerPath'))) {
  $value=[Environment]::GetEnvironmentVariable($override[0])
  if ($value) {
    $value=[IO.Path]::GetFullPath($value)
    if (-not $value.StartsWith($taskTemp+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $value -PathType Leaf)) { throw 'Regression source overrides must be isolated task-owned files.' }
    Set-Variable -Name $override[1] -Value $value
  }
}
$script:Assertions=0
$script:Groups=[Collections.Generic.List[string]]::new()
function Require([bool]$Value,[string]$Message) { $script:Assertions++; if (-not $Value) { throw ('DNS payload continuity: '+$Message) } }
function Assert-FixturePath([string]$Path) {
  $value=[IO.Path]::GetFullPath($Path)
  Require ($value.StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase)) 'A file mutation escaped the fixture root.'
  return $value
}
function Import-ProductionFunction([object]$Ast,[string]$Name) {
  $definition=$Ast.Find({param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -ceq $Name},$true)
  Require ($null -ne $definition) ('Missing production function '+$Name+'.')
  . ([scriptblock]::Create(($definition.Extent.Text -replace '^function ','function script:')))
  return $definition
}
function Read-ProductionAst([string]$Path) {
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  Require ($errors.Count -eq 0) ('Production source does not parse in Windows PowerShell: '+[IO.Path]::GetFileName($Path))
  return $ast
}
$cleanupAst=Read-ProductionAst $cleanupPath
$workerAst=Read-ProductionAst $workerPath
$cleanupHash=(Get-FileHash -LiteralPath $cleanupPath -Algorithm SHA256).Hash.ToLowerInvariant()
$workerHash=(Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
# Import only function declarations. Production top-level phase dispatch, native
# tasks and installer actions are never evaluated by this fixture.
foreach ($definition in $cleanupAst.FindAll({param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) {
  . ([scriptblock]::Create(($definition.Extent.Text -replace '^function ','function script:')))
}
foreach ($name in @('Restore-PreservedState','Get-SystemDohPrivatePolicyDigest','Get-SystemDohActivationDigest','Test-SystemDohConfigArgument','Get-SystemDohRecoveryFiles','Test-OwnedSystemDohRecoveryRuntime','Test-PreservedPrivateDnsIntent','Assert-SystemDohPayloadContinuity','Invoke-PayloadContinuityProbe','Invoke-SystemDohRuntimeMigration','Get-PatchedSystemDohMigrationConfiguration','Get-SystemDohMigrationCandidateDigest','Get-SystemDohPayloadContinuityLease','Close-SystemDohRuntimeLease')) {
  [void](Import-ProductionFunction $workerAst $name)
}

function Write-FixtureJson([string]$Path,[object]$Value) {
  $target=Assert-FixturePath $Path
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
  [IO.File]::WriteAllText($target,($Value|ConvertTo-Json -Depth 32),[Text.UTF8Encoding]::new($false))
}
function New-FixtureFile([string]$Path,[string]$Text) {
  $target=Assert-FixturePath $Path
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
  [IO.File]::WriteAllText($target,$Text,[Text.UTF8Encoding]::new($false))
}
function Get-FixtureTreeDigest([string]$Path) {
  $entries=@(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $Path -File -Recurse | Sort-Object FullName | ForEach-Object {
    $_.FullName.Substring($Path.Length)+'|'+(Get-FileSha256 $_.FullName)
  })
  return ($entries -join "`n")
}
function Require-WriteSharing([string]$Path,[bool]$ExpectedWritable) {
  $stream=$null;$writable=$false
  try { $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite);$writable=$true }
  catch [IO.IOException] { $writable=$false }
  finally { if($stream){$stream.Dispose()} }
  Require ($writable -eq $ExpectedWritable) ('Held file sharing unexpectedly '+$writable+' for '+[IO.Path]::GetFileName($Path))
}

# Every OS-changing boundary is either a harmless counter or forbidden. Actual
# NTFS operations below stay in this task's temporary fixture tree.
function sc.exe { param($Operation,$Name) Require ($Operation -eq 'delete') 'Unexpected controlled SCM action.';$script:DeletedServices.Add([string]$Name);[void]$script:ServicesByName.Remove([string]$Name) }
function reg.exe { throw 'Forbidden native registry mutation.' }
function Set-DnsClientServerAddress { throw 'Forbidden live adapter DNS mutation.' }
function Start-Process { throw 'Forbidden process launch.' }
function New-Object {
  [CmdletBinding()]param([Parameter(Position=0)][string]$TypeName,[string]$ComObject,[object[]]$ArgumentList)
  if ($ComObject) { throw 'Forbidden native COM/task boundary.' }
  if ($PSBoundParameters.ContainsKey('ArgumentList')) { return Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName -ArgumentList $ArgumentList }
  return Microsoft.PowerShell.Utility\New-Object -TypeName $TypeName
}
function Write-Journal { param($Event,$Data) $script:Journal.Add([string]$Event) }
function Add-ReceiptEvent { param($Stage,$Status,$Message,$Data) $script:Journal.Add([string]$Status) }
function Get-ServiceImagePath { param([string]$Name) if ($script:ServicesByName.ContainsKey($Name)) { return [string]$script:ServicesByName[$Name].PathName } return '' }
function Get-Service { [CmdletBinding()]param([string]$Name) if ($script:ServicesByName.ContainsKey($Name)) { return [pscustomobject]@{Name=$Name;Status='Running'} } return $null }
function Get-CimInstance {
  [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName,[string]$Filter,[int]$OperationTimeoutSec,$Property,$Namespace)
  $values=switch ($ClassName) {
    'Win32_Service' { @($script:ServicesByName.Values); break }
    'Win32_Process' { @($script:Processes); break }
    'MSFT_NetUDPEndpoint' { return @($script:UdpEndpoints) }
    'MSFT_NetTCPConnection' { return @($script:TcpEndpoints) }
    default { throw ('Forbidden uncontrolled CIM class '+$ClassName) }
  }
  if (-not $Filter) { return $values }
  if ($Filter -match "^Name='([^']+)'$") { return @($values|Where-Object { $_.Name -eq $Matches[1] }) }
  if ($Filter -match '^ProcessId=(\d+)$') { $requested=[int]$Matches[1];return @($values|Where-Object { [int]$_.ProcessId -eq $requested }) }
  throw ('Uncontrolled CIM filter '+$Filter)
}
function Get-ChildItem {
  [CmdletBinding()]param([string]$LiteralPath,[switch]$Recurse,[switch]$Force,[switch]$File,[switch]$Directory)
  if ($LiteralPath -like 'Registry::*') { return @() }
  [void](Assert-FixturePath $LiteralPath)
  return Microsoft.PowerShell.Management\Get-ChildItem @PSBoundParameters
}
function Stop-InstallerOwnedService { param([string]$Name,$OwnPath) $script:StoppedServices.Add($Name) }
function Stop-Process { [CmdletBinding()]param([int]$Id,[switch]$Force) $script:StoppedProcesses.Add($Id) }
function Get-Process {
  [CmdletBinding()]param([int]$Id)
  $item=@($script:Processes | Where-Object { [int]$_.ProcessId -eq $Id })
  if ($item.Count -ne 1) { throw 'Fixture process absent or ambiguous.' }
  $held=[pscustomobject]@{Id=$Id;Handle=1;HasExited=$script:HeldExited;StartTime=([DateTime]$item[0].CreationDate).AddSeconds($script:HeldBirthOffset);MainModule=[pscustomobject]@{FileName=if($script:HeldWrongImage){'C:\foreign.exe'}else{$item[0].ExecutablePath}}}
  $held | Add-Member ScriptMethod Dispose { $script:DisposedHandles++ }
  return $held
}
function Suspend-OwnedGuiLoginStartup {}
function Backup-OwnedServiceRegistrations { param($PreviouslyRunning) New-FixtureFile $serviceBackupManifestPath '[]' }
function Suspend-InstallerServiceRestarts { param($Records,$SnapshotPath,$OwnPath,$StopCore) foreach($record in @($Records)){ $script:DisabledServices.Add([string]$record.name) } }
function Test-CanonicalInstallerTarget { param($Root) return [string]::Equals([string]$Root,$installRoot,[StringComparison]::OrdinalIgnoreCase) }
function Test-VerifiedCanonicalInstalledApplication { param($Root) return Test-CanonicalInstallerTarget $Root }
function Test-OwnedPath { param($Path) try { return [IO.Path]::GetFullPath([string]$Path).StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase) } catch { return $false } }
function Assert-OwnedPath { param($Path,$Because) return Assert-FixturePath $Path }
function Protect-InstallerStageTree { param($Stage) [void](Assert-FixturePath $Stage) }
function Assert-PlainWrapperMigrationPath { param($Path,$Root) return Assert-FixturePath $Path }
function Assert-PreservedServiceRegistration { param($Record) return $Record }
function Get-PreservedRegistryBackup { param($Record) return $null }
function Assert-CurrentPreservedServiceOwnership { param($Name,[switch]$RequirePresent) if ($RequirePresent -and -not $script:ServicesByName.ContainsKey($Name)) { throw 'Fixture service absent.' } }
function Restore-PreservedServiceRegistration { param($Record) $script:RestoredRegistrations.Add([string]$Record.name) }
function Restore-CriticalDnsState { param($State) $script:OwnedDnsRestores++ }
function Invoke-OwnedSystemDohMigrationPreflight { param($State) $script:CandidateProbeCalls++;return $null }
function Prepare-SystemDohMigrationPayload { param($State,$Preflight) throw 'An unready candidate must never reach payload staging.' }
function Set-InstallerServiceStartMode { param($Name,$Mode,$Delayed,$OwnPath) $script:MigrationMutationCalls++;throw 'An unready candidate must never change service start mode.' }
function Stop-OwnedServiceForInstall { param($Name) $script:MigrationMutationCalls++;throw 'An unready candidate must never stop the production resolver.' }
function Write-VerifiedSystemDohRecoveryRuntime { param($State) $script:MigrationMutationCalls++;throw 'An unready candidate must never write a migrated runtime receipt.' }
function Write-JsonAtomic { param($Path,$Value) $script:MigrationStateWrites++;Write-FixtureJson $Path $Value }
function Assert-InstallerBootRecoveryFileProtection { param($Path,[switch]$Directory) [void](Assert-FixturePath $Path);if($script:UnsafeProtection){throw 'Fixture unsafe ACL.'} }
function Assert-InstallerBootRecoveryPlainPath { param($Path,[switch]$Leaf) [void](Assert-FixturePath $Path);Require (Test-Path -LiteralPath $Path) 'A protected fixture file is missing.' }
function Assert-InstallerMaintenanceBootRecovery {
  param($StageDirectory)
  if (-not $script:BootVerified -or -not [string]::Equals([string]$StageDirectory,$script:StageDirectory,[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture stage authentication refused.' }
  return [pscustomobject]@{verified=$true;schemaVersion=1;owner='EgoistShield';stage=$StageDirectory}
}
function Get-InstallerBootRecoveryContext { param($StageDirectory,[switch]$AllowLegacyInventory) return [pscustomobject]@{powerShell=$script:PowerShellImage;maintenanceMarker=$script:MaintenanceMarker} }
function Test-IsAdministrator { return $true }
function Get-ValidatedMaintenanceRecoveryState { param($Stage) [void](Assert-FixturePath (Join-Path $Stage 'state.json'));return Get-Content -LiteralPath (Join-Path $Stage 'state.json') -Raw | ConvertFrom-Json }
function Test-InstallerServiceMaintenanceOwner {
  $marker=Get-Content -LiteralPath $script:MaintenanceMarker -Raw | ConvertFrom-Json
  return $marker.schemaVersion -eq 1 -and $marker.owner -eq 'EgoistShield' -and $marker.stage -eq $StageDirectory
}
function Invoke-ProtectedSystemDohContinuityProbe {
  param([string]$Stage)
  Require ([string]::Equals($Stage,$StageDirectory,[StringComparison]::OrdinalIgnoreCase)) 'The readonly child probe escaped its protected stage.'
  $script:ReadonlyProbeCalls++
  return Invoke-PayloadContinuityProbe
}
function Move-OwnedDirectoryWithRetry { param([string]$Source,[string]$Destination) [void](Assert-FixturePath $Source);[void](Assert-FixturePath $Destination);[IO.Directory]::Move($Source,$Destination) }
function Repair-StaleOwnedRuntimeQuarantine { throw 'Unexpected stale runtime quarantine in fixture.' }
function Get-ValidatedUpgradeQuarantine { return $null }
function Invoke-RobocopyDirectory {
  param([string]$Source,[string]$Destination,[string[]]$ExcludeDirectories=@())
  [void](Assert-FixturePath $Source);[void](Assert-FixturePath $Destination)
  foreach ($file in @(Microsoft.PowerShell.Management\Get-ChildItem -LiteralPath $Source -File -Recurse)) {
    $relative=$file.FullName.Substring($Source.TrimEnd('\').Length+1)
    $excluded=$false
    foreach ($directory in $ExcludeDirectories) {
      if ($file.FullName.StartsWith(([IO.Path]::GetFullPath($directory).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase) -or $relative.Split('\')[0] -eq $directory) { $excluded=$true }
    }
    if ($excluded) { continue }
    $target=Assert-FixturePath (Join-Path $Destination $relative)
    $script:CopiedPaths.Add($target)
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::Copy($file.FullName,$target,$true)
  }
}

function Reset-Fixture {
  $cached=Get-Variable -Name protectedSystemDohPayloadLease -Scope Script -ErrorAction SilentlyContinue
  if ($cached -and $cached.Value) { Close-ProtectedSystemDohPayloadContinuity $cached.Value }
  $script:protectedSystemDohPayloadLease=$null
  # WinPS 5.1/.NET Framework still imposes MAX_PATH in these ordinary IO APIs.
  $case=Join-Path $fixtureRoot ([Guid]::NewGuid().ToString('N').Substring(0,8))
  $script:programDataRoot=Join-Path $case 'p'
  $script:RuntimeRoot=Join-Path $programDataRoot 'EgoistShield\Runtime'
  $script:OwnedDataRoot=Join-Path $programDataRoot 'EgoistShield'
  $script:StageDirectory=Join-Path $case 's'
  $script:installRoot=Join-Path $case 'i'
  $script:localAppDataRoot='';$script:roamingAppDataRoot=''
  $script:component=Join-Path $RuntimeRoot 'SystemDoH'
  $script:config=Join-Path $component 'config.json'
  $script:wrapper=Join-Path $component 'service-wrapper\egoistshield-system-doh-service.exe'
  $script:engine=Join-Path $component 'runtime\xray-system-doh.exe'
  $script:xml=[IO.Path]::ChangeExtension($wrapper,'.xml')
  $script:upgradeStateDirectory=Join-Path $case 'u'
  $script:runtimeQuarantineManifestPath=Join-Path $upgradeStateDirectory 'runtime-quarantine.json'
  $script:serviceBackupDirectory=Join-Path $upgradeStateDirectory 'service-backup'
  $script:serviceBackupManifestPath=Join-Path $serviceBackupDirectory 'manifest.json'
  foreach($directory in @($component,$StageDirectory,$installRoot,$upgradeStateDirectory)){[void][IO.Directory]::CreateDirectory($directory)}
  $configuration=@{dns=@{servers=@('https://private.example.invalid:8443/dns-query/fixture-only');queryStrategy='UseIPv4'};inbounds=@(@{listen='127.0.0.1';port=53;settings=@{network='tcp,udp'}});log=@{loglevel='error';error='old-error.log'}}
  Write-FixtureJson $config $configuration
  New-FixtureFile $wrapper 'Controlled wrapper bytes; never executed.'
  New-FixtureFile $engine 'Controlled Xray bytes; never executed.'
  New-FixtureFile $xml ('<service><id>EgoistShieldSystemDoH</id><executable>'+[Security.SecurityElement]::Escape($engine)+'</executable><arguments>run -c &quot;'+[Security.SecurityElement]::Escape($config)+'&quot;</arguments><log mode="roll-by-size"><sizeThreshold>4096</sizeThreshold><keepFiles>2</keepFiles></log><onfailure action="restart" delay="5 sec"/><onfailure action="restart" delay="10 sec"/><resetfailure>10 hours</resetfailure></service>')
  $privateRoot=Join-Path $StageDirectory 'runtime-backup\SystemDoH'
  foreach($relative in @('config.json','service-wrapper\egoistshield-system-doh-service.exe','service-wrapper\egoistshield-system-doh-service.xml','runtime\xray-system-doh.exe')){
    New-FixtureFile (Join-Path $privateRoot $relative) ([IO.File]::ReadAllText((Join-Path $component $relative)))
  }
  New-FixtureFile (Join-Path $RuntimeRoot 'TelegramProxy\runtime\tg.bin') 'Original Telegram runtime.'
  New-FixtureFile (Join-Path $StageDirectory 'runtime-backup\TelegramProxy\runtime\tg.bin') 'Restored Telegram runtime.'
  New-FixtureFile (Join-Path $StageDirectory 'runtime-backup\SystemDoH\cache-only.txt') 'This DNS subtree must not be copied.'
  $intent=Join-Path $case 'User\egoistshield-state.json'
  Write-FixtureJson $intent @{settings=@{systemDohEnabled=$true;systemDohUrl='https://private.example.invalid:8443/dns-query/fixture-only'}}
  New-FixtureFile (Join-Path $StageDirectory 'user-state\state-0.json') ([IO.File]::ReadAllText($intent))
  $journal='{"schemaVersion":1,"owner":"EgoistShield","servers":["127.0.0.1"]}'
  New-FixtureFile (Join-Path $StageDirectory 'dns-owned-state.json') $journal
  New-FixtureFile (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $journal
  $script:ownedServices=@('EgoistShieldCore','EgoistShieldSystemDoH','EgoistShieldTelegramProxy')
  $script:exclusiveServiceNamePattern='^(EgoistShield|EGISShield)'
  $script:legacyOwnedServices=@();$script:sharedNameServices=@()
  $script:ownedProcesses=@('EgoistShield.exe','egoistshield-system-doh-service.exe','xray-system-doh.exe','tg.bin')
  $script:sharedNameProcesses=@('xray.exe')
  $script:Services=@($ownedServices)
  $birth=[DateTime]::UtcNow.AddMinutes(-1)
  $script:ServicesByName=@{
    EgoistShieldSystemDoH=[pscustomobject]@{Name='EgoistShieldSystemDoH';State='Running';ProcessId=100;PathName=$wrapper;StartName='LocalSystem'}
    EgoistShieldCore=[pscustomobject]@{Name='EgoistShieldCore';State='Running';ProcessId=200;PathName=(Join-Path $installRoot 'resources\core-service\win-x64\EgoistShield.Service.exe');StartName='LocalSystem'}
    EgoistShieldTelegramProxy=[pscustomobject]@{Name='EgoistShieldTelegramProxy';State='Running';ProcessId=300;PathName=(Join-Path $RuntimeRoot 'TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe');StartName='LocalSystem'}
  }
  $script:Processes=@(
    [pscustomobject]@{Name='egoistshield-system-doh-service.exe';ProcessId=100;ParentProcessId=1;ExecutablePath=$wrapper;CreationDate=$birth;CommandLine=$wrapper},
    [pscustomobject]@{Name='xray-system-doh.exe';ProcessId=101;ParentProcessId=100;ExecutablePath=$engine;CreationDate=$birth.AddSeconds(1);CommandLine=('"'+$engine+'" run -c "'+$config+'"')},
    [pscustomobject]@{Name='EgoistShield.exe';ProcessId=201;ParentProcessId=1;ExecutablePath=(Join-Path $installRoot 'EgoistShield.exe');CreationDate=$birth;CommandLine='fixture'},
    [pscustomobject]@{Name='tg.bin';ProcessId=301;ParentProcessId=300;ExecutablePath=(Join-Path $RuntimeRoot 'TelegramProxy\runtime\tg.bin');CreationDate=$birth;CommandLine='fixture'},
    [pscustomobject]@{Name='xray.exe';ProcessId=999;ParentProcessId=1;ExecutablePath='C:\foreign\xray.exe';CreationDate=$birth;CommandLine='foreign fixture'}
  )
  $script:UdpEndpoints=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=101})
  $script:TcpEndpoints=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=101})
  $serviceRecords=@($ServicesByName.Values|ForEach-Object { [pscustomobject]@{name=$_.Name;pathName=$_.PathName;wasRunning=$true;startMode='Auto';delayedAutoStart=$false;wrapperSha256=if($_.Name -eq 'EgoistShieldSystemDoH'){Get-FileSha256 $wrapper}else{'0'*64}} })
  $script:State=[pscustomobject]@{schemaVersion=1;owner='EgoistShield';version='3.8.0';installationId='00000000-0000-0000-0000-000000000038';handoffStarted=$true;services=$serviceRecords;userState=@([pscustomobject]@{backupName='state-0.json';source=$intent;sha256=Get-FileSha256 $intent});criticalDns=@([pscustomobject]@{servers=@('127.0.0.1')})}
  $script:StoppedServices=[Collections.Generic.List[string]]::new();$script:DeletedServices=[Collections.Generic.List[string]]::new()
  $script:StoppedProcesses=[Collections.Generic.List[int]]::new();$script:DisabledServices=[Collections.Generic.List[string]]::new()
  $script:RestoredRegistrations=[Collections.Generic.List[string]]::new();$script:CopiedPaths=[Collections.Generic.List[string]]::new();$script:Journal=[Collections.Generic.List[string]]::new()
  $script:HeldExited=$false;$script:HeldBirthOffset=0;$script:HeldWrongImage=$false;$script:UnsafeProtection=$false;$script:DisposedHandles=0;$script:BootVerified=$true;$script:ReadonlyProbeCalls=0
  $script:OwnedDnsRestores=0;$script:Phase='PreInstall';$script:CandidateProbeCalls=0;$script:MigrationMutationCalls=0;$script:MigrationStateWrites=0
  $evidence=Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery -AsEvidence
  Require ($evidence -isnot [bool] -and $null -ne $evidence) 'The real local ownership proof refused the valid fixture.'
  $State | Add-Member NoteProperty payloadContinuity $evidence
  $script:PowerShellImage=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script:Processes+=@([pscustomobject]@{Name='powershell.exe';ProcessId=400;ParentProcessId=1;ExecutablePath=$PowerShellImage;CreationDate=$birth;CommandLine='controlled worker'})
  $script:MaintenanceMarker=Join-Path $programDataRoot 'EgoistShield\installer\service-maintenance.json'
  $installer=Join-Path $StageDirectory 'installer.exe';New-FixtureFile $installer 'Controlled installer bytes; never executed.'
  $State | Add-Member NoteProperty installer $installer
  $State | Add-Member NoteProperty sha256 (Get-FileSha256 $installer)
  New-FixtureFile (Join-Path $StageDirectory 'backup-ready.flag') 'ready'
  Write-FixtureJson (Join-Path $StageDirectory 'heartbeat.json') @{owner='EgoistShield';workerPid=400;workerStartTicks=$birth.Ticks;workerExecutable=$PowerShellImage}
  Write-FixtureJson $MaintenanceMarker @{schemaVersion=1;owner='EgoistShield';stage=$StageDirectory}
  Write-FixtureJson (Join-Path $StageDirectory 'state.json') $State
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$StageDirectory
}

function Assert-RefusedBeforeCleanup([string]$Name,[scriptblock]$Mutation) {
  Reset-Fixture
  & $Mutation
  $before=Get-FixtureTreeDigest $component
  $refused=$false
  try { Stop-AllOwnedRuntimes } catch { $refused=$true }
  Require $refused ($Name+' unexpectedly authorized cleanup.')
  Require ($script:StoppedServices.Count -eq 0 -and $script:StoppedProcesses.Count -eq 0 -and $script:DeletedServices.Count -eq 0) ($Name+' reached a destructive service/process boundary.')
  Require ((Get-FixtureTreeDigest $component) -ceq $before) ($Name+' changed the DNS runtime.')
}

$previousStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE
try {
  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  Stop-AllOwnedRuntimes
  Remove-OptionalOwnedServices
  Require (-not $script:StoppedServices.Contains('EgoistShieldSystemDoH') -and -not $script:DisabledServices.Contains('EgoistShieldSystemDoH') -and -not $script:DeletedServices.Contains('EgoistShieldSystemDoH')) 'The real cleanup stopped, disabled or removed the preserved DNS service.'
  Require (-not $script:StoppedProcesses.Contains(100) -and -not $script:StoppedProcesses.Contains(101)) 'The real process cleanup terminated the preserved DNS generation.'
  Require ($script:StoppedServices.Contains('EgoistShieldCore') -and $script:StoppedProcesses.Contains(201) -and $script:StoppedProcesses.Contains(301)) 'Continuity bypassed unrelated owned runtime cleanup.'
  Require (-not $script:StoppedProcesses.Contains(999)) 'Cleanup terminated a foreign same-name Xray.'
  Require ((Get-FixtureTreeDigest $component) -ceq $before) 'The private DNS runtime changed during service/process cleanup.'
  $script:Groups.Add('protected stop and service removal')

  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  New-OwnedRuntimeQuarantine
  Require (Test-Path -LiteralPath $component -PathType Container) 'Quarantine moved the preserved DNS component.'
  Require (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'TelegramProxy') -PathType Container)) 'Quarantine skipped the unrelated owned component.'
  $records=@(Read-OwnedRuntimeQuarantine)
  Require ($records.Count -eq 1 -and [IO.Path]::GetFileName([string]$records[0].source) -eq 'TelegramProxy') 'Quarantine journal retained an ancestor of the preserved DNS component.'
  Restore-OwnedRuntimeQuarantine
  Require ([IO.File]::ReadAllText((Join-Path $RuntimeRoot 'TelegramProxy\runtime\tg.bin')) -eq 'Original Telegram runtime.') 'Rollback did not restore the unrelated component bytes.'
  Require ((Get-FixtureTreeDigest $component) -ceq $before) 'Real quarantine/rollback changed the preserved DNS tree.'
  Remove-OwnedRuntimeDirectories
  Require ((Test-Path -LiteralPath $component) -and -not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'TelegramProxy'))) 'Runtime removal did not preserve only the proved DNS component.'
  $script:Groups.Add('real optional runtime quarantine and rollback')

  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  Restore-PreservedState -State $State -PreserveSystemDohRuntime
  Require ((Get-FixtureTreeDigest $component) -ceq $before) 'The preserved-state copy overwrote the held DNS generation.'
  Require (-not (Test-Path -LiteralPath (Join-Path $component 'cache-only.txt'))) 'The excluded DNS backup subtree was copied.'
  Require ([IO.File]::ReadAllText((Join-Path $RuntimeRoot 'TelegramProxy\runtime\tg.bin')) -eq 'Restored Telegram runtime.') 'The copy exclusion accidentally skipped unrelated runtime restoration.'
  Require (-not $script:RestoredRegistrations.Contains('EgoistShieldSystemDoH') -and $script:RestoredRegistrations.Contains('EgoistShieldTelegramProxy')) 'Registration restoration replaced the preserved DNS service or skipped Telegram.'
  $script:Groups.Add('preserved runtime copy boundary')

  Assert-RefusedBeforeCleanup 'Invalid protected boot proof' {$script:BootVerified=$false}
  Assert-RefusedBeforeCleanup 'Missing protected stage' {$env:EGOIST_PROTECTED_REINSTALL_STAGE=Join-Path $fixtureRoot 'missing-stage'}
  Assert-RefusedBeforeCleanup 'Foreign maintenance marker' {Write-FixtureJson $MaintenanceMarker @{schemaVersion=1;owner='Foreign';stage=$StageDirectory}}
  $script:Groups.Add('invalid and missing stage refusal')

  Assert-RefusedBeforeCleanup 'Foreign service PID' {$script:ServicesByName['EgoistShieldSystemDoH'].ProcessId=999}
  Assert-RefusedBeforeCleanup 'Foreign engine image' {$script:Processes[1].ExecutablePath='C:\foreign\xray.exe'}
  Assert-RefusedBeforeCleanup 'Reused held PID birth' {$script:HeldBirthOffset=1}
  Assert-RefusedBeforeCleanup 'Wrong held process image' {$script:HeldWrongImage=$true}
  $script:Groups.Add('foreign PID and image refusal')

  Assert-RefusedBeforeCleanup 'Changed config bytes' {[IO.File]::AppendAllText($config,' ')}
  Assert-RefusedBeforeCleanup 'Changed actual config argument' {$script:Processes[1].CommandLine='xray run -c C:\foreign.json'}
  Assert-RefusedBeforeCleanup 'Changed recorded original generation' {$State.payloadContinuity.enginePid=123;Write-FixtureJson (Join-Path $StageDirectory 'state.json') $State}
  Assert-RefusedBeforeCleanup 'Duplicate recorded fixed inventory' {$State.payloadContinuity.files=@($State.payloadContinuity.files[0],$State.payloadContinuity.files[0],$State.payloadContinuity.files[0],$State.payloadContinuity.files[0]);Write-FixtureJson (Join-Path $StageDirectory 'state.json') $State}
  Assert-RefusedBeforeCleanup 'Foreign UDP listener owner' {$script:UdpEndpoints[0].OwningProcess=999}
  $script:Groups.Add('config generation refusal')

  Reset-Fixture
  $intent=$State.userState[0].source
  Write-FixtureJson $intent @{settings=@{systemDohEnabled=$false;systemDohUrl='https://private.example.invalid:8443/dns-query/fixture-only'}}
  New-FixtureFile (Join-Path $StageDirectory 'user-state\state-0.json') ([IO.File]::ReadAllText($intent))
  $State.userState[0].sha256=Get-FileSha256 $intent
  $State.payloadContinuity=$null
  Write-FixtureJson (Join-Path $StageDirectory 'state.json') $State
  Require (-not (Test-PreservedPrivateDnsIntent -State $State)) 'Manual-off saved intent was treated as enabled.'
  Require ($null -eq (Get-ProtectedSystemDohPayloadContinuity)) 'Manual-off received a DNS process exemption.'
  Stop-AllOwnedRuntimes
  Require ($script:StoppedServices.Contains('EgoistShieldSystemDoH') -and $script:StoppedProcesses.Contains(101)) 'Manual-off changed ordinary stop semantics.'
  $script:Groups.Add('manual-off has no continuity exemption')

  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  $oldPids=@($State.payloadContinuity.wrapperPid,$State.payloadContinuity.enginePid)
  $lease=Get-ProtectedSystemDohPayloadContinuity
  # The native readiness subprocess is a controlled null result; the actual
  # migration selector must return before stop, staging, copy or receipt writes.
  $migrated=Invoke-SystemDohRuntimeMigration -State $State
  Require (-not $migrated -and $script:CandidateProbeCalls -eq 1) 'The real migration selector accepted the unready private candidate.'
  Require ($script:MigrationMutationCalls -eq 0 -and $script:MigrationStateWrites -eq 0 -and $script:CopiedPaths.Count -eq 0) 'The unready branch reached a stop, copy or persistent generation write.'
  Require ($script:Journal.Contains('private-dns-migration-deferred')) 'The real migration selector concealed the deferred private candidate.'
  [void](Assert-ProtectedSystemDohPayloadLease $lease)
  Require ((Get-FixtureTreeDigest $component) -ceq $before) 'Candidate refusal/rollback changed the original private DNS generation.'
  Require ($oldPids[0] -eq $lease.proof.wrapperPid -and $oldPids[1] -eq $lease.proof.enginePid -and $script:StoppedProcesses.Count -eq 0) 'Candidate refusal lost the held original DNS processes.'
  $script:Groups.Add('candidate-unready keeps original private generation')

  Reset-Fixture
  $commitLease=Get-SystemDohPayloadContinuityLease -State $State
  try {
    Require ($commitLease.handles.Count -eq 2 -and $commitLease.streams.Count -eq 6) 'The actual commit lease did not hold runtime, intent, journal and both original processes.'
    foreach ($file in @($State.payloadContinuity.files)) { Require-WriteSharing (Join-Path $component $file.path) $false }
    Require-WriteSharing $State.userState[0].source $false
    Require-WriteSharing (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $false
    Close-SystemDohRuntimeLease -Lease $commitLease -RuntimeFilesOnly
    Require-WriteSharing $config $true
    Require-WriteSharing $State.userState[0].source $false
    Require-WriteSharing (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $false
  } finally { Close-SystemDohRuntimeLease -Lease $commitLease }
  Require-WriteSharing $State.userState[0].source $true
  Require-WriteSharing (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $true
  $script:Groups.Add('commit leases pin runtime intent and journal')

  # Exercise the real staging path, including XML/config byte writes. Only the
  # packaged/pinned binary lookup and existing ACL/native leaves are controlled.
  [void](Import-ProductionFunction $workerAst 'Prepare-SystemDohMigrationPayload')
  function script:Get-VerifiedPackagedServiceWrapper {
    param($Version)
    Require ($Version -ceq [string]$State.version) 'Staging selected a different packaged wrapper version.'
    return [pscustomobject]@{path=$script:PackagedWrapper;sha256=(Get-FileSha256 $script:PackagedWrapper)}
  }
  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  $original=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  $patched=Get-PatchedSystemDohMigrationConfiguration $original
  $expectedDigest=Get-SystemDohMigrationCandidateDigest $patched
  $script:PackagedWrapper=Join-Path $installRoot 'pinned-wrapper.bin'
  New-FixtureFile $script:PackagedWrapper 'Controlled pinned packaged wrapper; never executed.'
  $staged=Prepare-SystemDohMigrationPayload -State $State -Preflight ([pscustomobject]@{candidateSha256=$expectedDigest})
  Require ($staged.files.Count -eq 3 -and $staged.root -ceq $component) 'Actual staging did not return the exact3 replacement files and original root.'
  $candidate=Get-Content -LiteralPath $staged.files[0].source -Raw | ConvertFrom-Json
  Require ((Get-SystemDohMigrationCandidateDigest $candidate) -ceq $expectedDigest -and $staged.candidateSha256 -ceq $expectedDigest) 'Actual staged config changed its leaf-v1 preflight digest.'
  Require ((Get-SystemDohPrivatePolicyDigest $candidate) -ceq (Get-SystemDohPrivatePolicyDigest $original)) 'Actual staging changed the saved private DNS policy.'
  Require ($candidate.dns.serveStale -eq $true -and $candidate.dns.serveExpiredTTL -eq 120 -and $candidate.log.error -ceq '') 'Actual staging omitted the fixed cache/log migration fields.'
  [xml]$candidateXml=[IO.File]::ReadAllText($staged.files[1].source)
  $failures=@($candidateXml.SelectNodes('/service/onfailure'))
  Require ($failures.Count -eq 3 -and (($failures | ForEach-Object { $_.GetAttribute('delay') }) -join '|') -ceq '0 sec|1 sec|60 sec') 'Actual DNS staging did not set exact0/1/60 restart delays.'
  Require (@($failures | Where-Object { $_.GetAttribute('action') -cne 'restart' }).Count -eq 0) 'Actual DNS staging included a non-restart action.'
  Require ($candidateXml.service.resetfailure -ceq '1 hour' -and $candidateXml.service.log.sizeThreshold -ceq '10240' -and $candidateXml.service.log.keepFiles -ceq '5') 'Actual DNS staging did not set bounded logging and failure reset.'
  Require ($candidateXml.service.executable -ceq $engine -and $candidateXml.service.arguments -ceq ('run -c "'+$config+'"')) 'Actual DNS staging changed the production engine/config target.'
  foreach($file in @($staged.files)) { Require ((Get-FileSha256 $file.source) -ceq $file.sha256) 'Actual staged file inventory did not match its bytes.' }
  Require ((Get-FileSha256 $staged.files[2].source) -ceq (Get-FileSha256 $script:PackagedWrapper)) 'Actual staging did not copy the pinned wrapper bytes.'
  Require ((Get-FixtureTreeDigest $component) -ceq $before -and $script:StoppedServices.Count -eq 0 -and $script:StoppedProcesses.Count -eq 0 -and $script:MigrationMutationCalls -eq 0) 'Actual staging mutated/stopped the old private generation.'
  $refused=$false
  try { [void](Prepare-SystemDohMigrationPayload -State $State -Preflight ([pscustomobject]@{candidateSha256=$expectedDigest})) } catch { $refused=$_.Exception.Message -match 'already exists' }
  Require $refused 'Actual staging accepted a stale existing candidate.'
  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  $refused=$false
  try { [void](Prepare-SystemDohMigrationPayload -State $State -Preflight ([pscustomobject]@{candidateSha256=('0'*64)})) } catch { $refused=$_.Exception.Message -match 'does not match' }
  Require $refused 'Actual staging accepted a foreign candidate digest.'
  Require ((Get-FixtureTreeDigest $component) -ceq $before -and $script:MigrationMutationCalls -eq 0) 'A foreign staging digest changed the production generation.'
  $script:Groups.Add('actual DNS candidate staging uses fast retry and private leaf digest')

  Reset-Fixture
  $before=Get-FixtureTreeDigest $component
  $script:SwitchStarts=0
  function script:Invoke-OwnedSystemDohMigrationPreflight { param($State) $script:CandidateProbeCalls++;return [pscustomobject]@{ready=$true} }
  function script:Prepare-SystemDohMigrationPayload {
    param($State,$Preflight)
    $directory=Join-Path $StageDirectory 'candidate'
    $patched=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    $patched.dns | Add-Member NoteProperty serveStale $true
    Write-FixtureJson (Join-Path $directory 'config.json') $patched
    New-FixtureFile (Join-Path $directory 'wrapper.xml') ([IO.File]::ReadAllText($xml)+' ')
    New-FixtureFile (Join-Path $directory 'wrapper.exe') 'Controlled new wrapper bytes; never executed.'
    $files=@([pscustomobject]@{source=(Join-Path $directory 'config.json');relative='config.json'},[pscustomobject]@{source=(Join-Path $directory 'wrapper.xml');relative='service-wrapper\egoistshield-system-doh-service.xml'},[pscustomobject]@{source=(Join-Path $directory 'wrapper.exe');relative='service-wrapper\egoistshield-system-doh-service.exe'})
    foreach($file in $files){$file | Add-Member NoteProperty sha256 (Get-FileSha256 $file.source)}
    return [pscustomobject]@{root=$component;files=$files;candidateSha256=(Get-SystemDohMigrationCandidateDigest $patched)}
  }
  function script:Set-InstallerServiceStartMode {
    param($Name,$Mode,$Delayed,$OwnPath)
    $script:MigrationMutationCalls++;Require ($Name -eq 'EgoistShieldSystemDoH') 'Migration changed a different service.'
    if ($Mode -eq 'Disabled') { Require-WriteSharing $config $false }
    Require-WriteSharing $State.userState[0].source $false
    Require-WriteSharing (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $false
  }
  function script:Stop-OwnedServiceForInstall { param($Name) $script:MigrationMutationCalls++;$script:ServicesByName[$Name].State='Stopped' }
  function script:Assert-PreservedWrapperStopped { param($Name,$Wrapper) Require ($script:ServicesByName[$Name].State -eq 'Stopped') 'The real switch replaced files before stopping its controlled service.' }
  function script:Write-VerifiedSystemDohRecoveryRuntime { param($State) $script:MigrationMutationCalls++ }
  function script:Start-VerifiedSystemDohSwitch {
    param($State,[switch]$PreservedRuntimeRecovery)
    $script:SwitchStarts++
    Require-WriteSharing $State.userState[0].source $false
    Require-WriteSharing (Join-Path $OwnedDataRoot 'Service\dns-owned-state.json') $false
    if (-not $PreservedRuntimeRecovery) { throw 'Controlled new-generation start failure after real file replacements.' }
    $script:ServicesByName['EgoistShieldSystemDoH'].State='Running'
    $script:ServicesByName['EgoistShieldSystemDoH'].ProcessId=110
    $script:Processes[0].ProcessId=110;$script:Processes[1].ProcessId=111;$script:Processes[1].ParentProcessId=110
    $script:Processes[0].CreationDate=[DateTime]::UtcNow;$script:Processes[1].CreationDate=$script:Processes[0].CreationDate.AddMilliseconds(1)
    $script:UdpEndpoints[0].OwningProcess=111;$script:TcpEndpoints[0].OwningProcess=111
    Require (Test-OwnedSystemDohRecoveryRuntime -State $State -PreservedRuntimeRecovery) 'Immediate rollback did not verify original bytes and new owned process generation.'
  }
  $refused=$false
  try { [void](Invoke-SystemDohRuntimeMigration -State $State) } catch { $refused=$_.Exception.Message -eq 'Controlled new-generation start failure after real file replacements.' }
  Require $refused 'The real failed-switch branch did not preserve the original failure after immediate recovery.'
  Require ((Get-FixtureTreeDigest $component) -ceq $before) 'The real failed-switch rollback did not restore original config/XML/wrapper bytes.'
  Require ($script:SwitchStarts -eq 2 -and $State.dnsMigrationStarted -eq $false) 'Immediate rollback did not start the original generation and clear its pending switch.'
  Require ($State.payloadContinuity.wrapperPid -eq 110 -and $State.payloadContinuity.enginePid -eq 111) 'Rollback rebound continuity to stale pre-stop PIDs.'
  Require ($script:Journal.Contains('private-dns-switch-rolled-back') -and $script:MigrationStateWrites -eq 2) 'The restored rollback generation was not durably recorded.'
  $script:Groups.Add('failed switch restores authenticated original bytes')

  Require ((Get-FileSha256 $cleanupPath) -ceq $cleanupHash -and (Get-FileSha256 $workerPath) -ceq $workerHash) 'Production source changed during the fixture; rerun against a frozen generation.'
  $receiptPath=Assert-FixturePath (Join-Path $fixtureRoot 'dns-payload-continuity-test.json')
  $receipt=[ordered]@{
    schemaVersion=1;passed=$true;groupCount=$script:Groups.Count;assertionCount=$script:Assertions;groups=@($script:Groups)
    cleanupSha256=$cleanupHash;workerSha256=$workerHash
    nativeScmMutations=0;nativeDnsWrites=0;nativeProcessStarts=0;nativeProcessKills=0;nativeTaskChanges=0
    actualBoundaries=@('production AST function bodies','real held NTFS FileStreams and SHA256 bytes','real quarantine/rollback directory moves','actual preserved-state copy exclusions','real private runtime proof and lease assertions','real migration file replacement and authenticated original-byte rollback')
    controlledBoundaries=@('boot task/ACL verification','CIM/process handle records','SCM/termination leaves','readonly child process replaced with the real worker probe in the same fixture','robocopy process replaced with scoped file copying')
    limits=@('No production service, DNS, task, GUI, or process was changed.','The actual migration selector executes with a controlled native readiness refusal; actual Xray/private HTTPS readiness and native migration are checked separately.','CIM and process handles are controlled identity records; this does not prove native SCM restart or Task Scheduler execution.')
  }
  [IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Depth 32),[Text.UTF8Encoding]::new($false))
  Write-Output ('Installer DNS payload continuity: '+$script:Groups.Count+' groups passed; '+$script:Assertions+' assertions; native SCM/DNS/process/task mutations 0')
} finally {
  if ($script:protectedSystemDohPayloadLease) { Close-ProtectedSystemDohPayloadContinuity $script:protectedSystemDohPayloadLease;$script:protectedSystemDohPayloadLease=$null }
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$previousStage
}
