param(
  [string]$SourceScript = (Join-Path $PSScriptRoot '..\scripts\invoke-final-silent-reinstall.ps1'),
  [string]$WrapperSource = (Join-Path $PSScriptRoot '..\resources\runtime\zapret\service-wrapper\egoistshield-zapret-service.exe')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if (-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)) { throw 'Set task-scoped LAGOM_TEST_TEMP.' }
$fixtureRoot = Join-Path $env:LAGOM_TEST_TEMP ('[x] ' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$script:RuntimeRoot = Join-Path $fixtureRoot 'Runtime'
$script:OwnedInstallRoot = Join-Path $fixtureRoot 'Installed'
$StageDirectory = Join-Path $fixtureRoot 'Stage'
$null = New-Item -ItemType Directory -Path $script:RuntimeRoot,$script:OwnedInstallRoot,$StageDirectory -Force
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath($SourceScript), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fixtureLease='Local\LagomWrapperMigration-'+[Guid]::NewGuid().ToString('N')
foreach ($name in @('Get-FileSha256','Write-JsonAtomic','Get-PreservedWrapperDefinitions','Assert-PlainWrapperMigrationPath','Get-VerifiedPackagedServiceWrapper','Update-PreservedSystemDohEngine','Assert-PreservedWrapperStopped','Update-PreservedServiceWrappers','Stop-PreservedWrappersForRecovery','Assert-SupportedServiceFramework','Invoke-WorkerMode','Assert-InstallerNotCancelled','Enter-InstallerWorkerLease')) {
  $fn = $ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name}, $true)
  if ($fn) { . ([scriptblock]::Create($fn.Extent.Text.Replace('Global\EgoistShield.DeferredReinstall',$fixtureLease))) }
}
function New-InstallerProtectedFileSecurity {
  $security=New-Object Security.AccessControl.FileSecurity
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($identity);$security.SetAccessRuleProtection($true,$false)
  $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  return $security
}
function Unregister-InstallerMaintenanceBootRecovery {param($StageDirectory,$RestorationVerified)}
function Require { param([bool]$Value, [string]$Message) if (-not $Value) { throw $Message } }
function Expect-Refused { param([scriptblock]$Action, [string]$Pattern) $refused=$false; try { & $Action } catch { $refused=$_.Exception.Message -like $Pattern }; Require $refused ('Expected refusal: ' + $Pattern) }
$script:registrations = @{}
$script:statuses = @{}
$script:stops = @()
$script:cimQueryFails = $false
function Get-Service { param($Name,$ErrorAction) return [pscustomobject]@{Status=$script:statuses[$Name]} }
function Get-CimInstance {
  param($ClassName,$Filter,$ErrorAction,$Property,$OperationTimeoutSec)
  if($script:cimQueryFails){throw 'Fixture CIM lookup failed'}
  if($ClassName -eq 'Win32_Process') { if($script:liveEngine){return [pscustomobject]@{ExecutablePath=$engine}};return @() }
  $name=($Filter -replace "^Name='",'' -replace "'$",''); return [pscustomobject]@{PathName=$script:registrations[$name]}
}
function Assert-InstallerBootRecoveryFileProtection {
  param($Path)
  Require ([IO.Path]::GetFullPath($Path).StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase)) 'Protection adapter escaped the fixture.'
}
function Assert-OwnedSystemDohInputSingleLink {
  param([IO.FileStream]$Stream)
  Require ($Stream -and -not $Stream.SafeFileHandle.IsClosed) 'Input lease was not held.'
}
$script:liveEngine=$false
function Stop-OwnedServiceForInstall { param($Name) $script:stops += $Name; $script:statuses[$Name]='Stopped' }
function Update-PreservedRuntimeReliability { param($State) }
function Write-VerifiedSystemDohRecoveryRuntime { param($State) }
function Restore-PreservedState {
  param($State)
  foreach ($record in $State.services) {
    $relative=([string]$record.pathName).Substring($script:RuntimeRoot.Length+1)
    Copy-Item -LiteralPath (Join-Path (Join-Path $StageDirectory 'runtime-backup') $relative) -Destination $record.pathName -Force
  }
}
$hash='B5066B7BBDFBA1293E5D15CDA3CAAEA88FBEAB35BD5B38C41C913D492AADFC4F'
$relative='zapret/service-wrapper/egoistshield-zapret-service.exe'
$packaged=Join-Path $script:OwnedInstallRoot ('resources\runtime\' + $relative)
$null=New-Item -ItemType Directory -Path (Split-Path -Parent $packaged) -Force
$canonical=[IO.Path]::GetFullPath($WrapperSource)
Require ((Get-FileSha256 $canonical) -eq $hash) 'Fixture requires the exact verified Framework WinSW payload.'
Copy-Item -LiteralPath $canonical -Destination $packaged
$manifestPath=Join-Path $script:OwnedInstallRoot 'resources\runtime\manifest.json'
$manifest=[pscustomobject]@{schemaVersion=1;packageVersion='3.8.0';components=@([pscustomobject]@{name='zapret';present=$true;files=@([pscustomobject]@{path=$relative;sha256=$hash;size=655872})})}
function Reset-Manifest {
  Write-JsonAtomic -Path $manifestPath -Value $manifest
  Write-JsonAtomic -Path $inventoryPath -Value ([pscustomobject]@{schemaVersion=1;owner='EgoistShield';files=@([pscustomobject]@{path='resources/runtime/manifest.json';roles=@('cli');bytes=([IO.FileInfo]$manifestPath).Length;sha256=(Get-FileSha256 $manifestPath)})})
}
$inventoryPath=Join-Path $script:OwnedInstallRoot 'resources\worker-host-integrity.json'
$engineSource=Join-Path $script:OwnedInstallRoot 'resources\runtime\xray\xray.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $engineSource) -Force | Out-Null
[IO.File]::WriteAllText($engineSource,'New shipped engine sentinel; never executed.')
$engineHash=Get-FileSha256 $engineSource
$manifest.components += [pscustomobject]@{name='xray';present=$true;files=@([pscustomobject]@{path='xray/xray.exe';sha256=$engineHash;size=([IO.FileInfo]$engineSource).Length})}
Reset-Manifest
$records=@()
foreach ($definition in @(@('EgoistShieldSystemDoH','SystemDoH','egoistshield-system-doh-service'),@('EgoistShieldTelegramProxy','TelegramProxy','egoistshield-telegram-proxy-service'),@('EgoistShieldZapret','Zapret','egoistshield-zapret-service'))) {
  $path=Join-Path $script:RuntimeRoot ($definition[1] + '\service-wrapper\' + $definition[2] + '.exe')
  $backup=Join-Path (Join-Path $StageDirectory 'runtime-backup') ($definition[1] + '\service-wrapper\' + $definition[2] + '.exe')
  $null=New-Item -ItemType Directory -Path (Split-Path -Parent $path),(Split-Path -Parent $backup) -Force
  [IO.File]::WriteAllText($path,'preserved-wrapper-' + $definition[0]); Copy-Item -LiteralPath $path -Destination $backup
  $records += [pscustomobject]@{name=$definition[0];pathName=$path;wrapperSha256=(Get-FileSha256 $path);wasRunning=($definition[0] -ne 'EgoistShieldZapret')}
  $script:registrations[$definition[0]]='"' + $path + '"'
  $script:statuses[$definition[0]]='Stopped'
}
$state=[pscustomobject]@{version='3.8.0';services=$records;wrapperMigrationPending=$false;handoffStarted=$false}
$engine=Join-Path $script:RuntimeRoot 'SystemDoH\runtime\xray-system-doh.exe'
$engineBackup=Join-Path $StageDirectory 'runtime-backup\SystemDoH\runtime\xray-system-doh.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $engine),(Split-Path -Parent $engineBackup) -Force | Out-Null
[IO.File]::WriteAllText($engine,'Old preserved engine sentinel; never executed.')
Copy-Item -LiteralPath $engine -Destination $engineBackup
$privateConfig=Join-Path $script:RuntimeRoot 'SystemDoH\config.json'
[IO.File]::WriteAllText($privateConfig,'{"privateProvider":"fixture.invalid","hosts":{"private.invalid":"192.0.2.4"}}')
$privateConfigHash=Get-FileSha256 $privateConfig
# Execute the actual post-restore statements from Invoke-WorkerMode. On the
# archived baseline this restores the old aliases without upgrading binaries.
$worker=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-WorkerMode'},$true)
$workflow=[regex]::Match($worker.Extent.Text,'(?ms)^\s+Restore-PreservedState -State \$state(?: -PreserveSystemDohRuntime:\$keepDns)?\r?\n(?<steps>.*?)^\s+Reconcile-PreservedZapretProfile -State \$state')
Require $workflow.Success 'Could not find the actual worker post-restore sequence.'
$keepDns=$false
. ([scriptblock]::Create('Restore-PreservedState -State $state' + "`n" + $workflow.Groups['steps'].Value))
foreach ($record in $records) { Require ((Get-FileSha256 $record.pathName) -eq $hash) ('Worker preserved the obsolete wrapper: ' + $record.name) }
Require ((Get-Content -LiteralPath (Join-Path $StageDirectory 'state.json') -Raw | ConvertFrom-Json).wrapperMigrationPending -eq $true) 'Rollback state was not persisted before migration.'
Require ($records[2].wasRunning -eq $false) 'Migration changed the stopped-service intent.'
Write-Output 'PASS: actual worker restore sequence migrates three exact stopped aliases and records rollback state'
Require ((Get-FileSha256 $engine) -eq $engineHash -and (Get-FileSha256 $privateConfig) -eq $privateConfigHash -and $state.systemDohEngineSha256 -eq $engineHash) 'Actual worker sequence retained old engine or changed private config.'
Require ((Get-Content -LiteralPath (Join-Path $StageDirectory 'state.json') -Raw | ConvertFrom-Json).systemDohEngineSha256 -eq $engineHash) 'New engine digest was not persisted before mutation.'
Write-Output 'PASS: actual worker sequence selects the newly pinned engine while keeping private config'
Update-PreservedServiceWrappers $state
Write-Output 'PASS: verified aliases are idempotent and stopped intent is preserved'

function Reset-Wrappers { Restore-PreservedState $state; $state.wrapperMigrationPending=$false }
function Assert-Originals { foreach($record in $records) { Require ((Get-FileSha256 $record.pathName) -eq $record.wrapperSha256) 'Refused migration modified a wrapper.' } }
Reset-Wrappers
$script:statuses[$records[2].name]='Running'
Expect-Refused { Update-PreservedServiceWrappers $state } '*requires stopped service*'; Assert-Originals
$script:statuses[$records[2].name]='Stopped'
Write-Output 'PASS: a running third service prevents every replacement'
$saved=$script:registrations[$records[2].name]; $script:registrations[$records[2].name]='C:\foreign\service.exe'
Expect-Refused { Update-PreservedServiceWrappers $state } '*current service ownership mismatch*'; Assert-Originals
$script:registrations[$records[2].name]=$saved
Write-Output 'PASS: changed current SCM ownership prevents every replacement'
$script:cimQueryFails=$true
Expect-Refused { Update-PreservedServiceWrappers $state } '*Fixture CIM lookup failed*'; Assert-Originals
$script:cimQueryFails=$false
Write-Output 'PASS: a CIM query failure prevents every replacement'
$saved=$records[2].pathName; $records[2].pathName='C:\foreign\service.exe'
Expect-Refused { Update-PreservedServiceWrappers $state } '*saved service ownership mismatch*'; $records[2].pathName=$saved; Assert-Originals
Write-Output 'PASS: changed saved registration prevents every replacement'
$manifest.components[0].files[0].sha256='0'*64; Reset-Manifest
Expect-Refused { Update-PreservedServiceWrappers $state } '*does not match the pinned*'; Assert-Originals
$manifest.components[0].files[0].sha256=$hash; Reset-Manifest
Write-Output 'PASS: a substituted manifest hash cannot approve arbitrary code'
[IO.File]::WriteAllText($packaged,'substituted')
Expect-Refused { Update-PreservedServiceWrappers $state } '*failed pinned checksum*'; Assert-Originals
Copy-Item -LiteralPath $canonical -Destination $packaged -Force
Write-Output 'PASS: corrupt packaged source prevents every replacement'
$manifest.packageVersion='3.7.9'; Reset-Manifest
Expect-Refused { Update-PreservedServiceWrappers $state } '*not the installed release*'; Assert-Originals
$manifest.packageVersion='3.8.0'; Reset-Manifest
Write-Output 'PASS: a stale installed manifest prevents every replacement'
$backup=Join-Path (Join-Path $StageDirectory 'runtime-backup') (($records[2].pathName).Substring($script:RuntimeRoot.Length+1))
[IO.File]::WriteAllText($backup,'substituted')
Expect-Refused { Update-PreservedServiceWrappers $state } '*original checksum*'; Assert-Originals
Copy-Item -LiteralPath $records[2].pathName -Destination $backup -Force
Write-Output 'PASS: altered original backup prevents every replacement'
[IO.File]::WriteAllText($records[2].pathName,'substituted')
Expect-Refused { Update-PreservedServiceWrappers $state } '*not the preserved or new verified*'
Require ((Get-FileSha256 $records[0].pathName) -eq $records[0].wrapperSha256) 'A corrupt later alias allowed an earlier replacement.'
Copy-Item -LiteralPath $backup -Destination $records[2].pathName -Force
Write-Output 'PASS: an unknown current binary prevents every replacement'
$state.services=@($records)+@($records[0])
Expect-Refused { Update-PreservedServiceWrappers $state } '*snapshot is ambiguous*'; Assert-Originals
$state.services=$records
Write-Output 'PASS: duplicate service ownership records are refused'
$locked=[IO.File]::Open($records[1].pathName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
  $sharingViolation=$false
  try { Update-PreservedServiceWrappers $state } catch {
    $failure=$_.Exception
    while($failure.InnerException){$failure=$failure.InnerException}
    $sharingViolation=($failure.HResult -band 0xFFFF) -in @(32,33)
  }
  Require $sharingViolation 'Locked alias did not fail with an actual Windows sharing violation.'
} finally { $locked.Dispose() }
Require ((Get-FileSha256 $records[0].pathName) -eq $hash) 'Fixture did not exercise a partial atomic migration.'
Require ((Get-FileSha256 $records[1].pathName) -eq $records[1].wrapperSha256) 'Locked file was overwritten.'
Require (@(Get-ChildItem -LiteralPath $script:RuntimeRoot -Recurse -Filter '*.migration-*').Count -eq 0) 'Temporary migration file leaked.'
$script:stops=@(); foreach($record in $records) { $script:statuses[$record.name]='Running' }
Stop-PreservedWrappersForRecovery $state
Require ($script:stops.Count -eq 3) 'Recovery did not stop the three exact migrated services.'
Restore-PreservedState $state; Assert-Originals
Write-Output 'PASS: locked second alias fails atomically; recovery stops three owned aliases and restores originals'
$script:stops=@(); $state.wrapperMigrationPending=$false
Stop-PreservedWrappersForRecovery $state
Require ($script:stops.Count -eq 0) 'Recovery stopped wrappers when migration never started.'
Write-Output 'PASS: an unstarted wrapper migration causes no service stop'
$state.wrapperMigrationPending=$true; $script:registrations[$records[0].name]='C:\foreign\service.exe'
Expect-Refused { Stop-PreservedWrappersForRecovery $state } '*rollback service ownership mismatch*'
Require ($script:stops.Count -eq 0) 'Recovery stopped a changed registration.'
$script:registrations[$records[0].name]='"'+$records[0].pathName+'"'
Write-Output 'PASS: recovery rejects a substituted SCM registration'
$script:cimQueryFails=$true
Expect-Refused { Stop-PreservedWrappersForRecovery $state } '*Fixture CIM lookup failed*'
Require ($script:stops.Count -eq 0) 'Recovery treated a failed CIM query as a missing service.'
$script:cimQueryFails=$false
Write-Output 'PASS: recovery propagates a CIM lookup failure without stopping an unverified service'

$link=Join-Path $script:RuntimeRoot 'SystemDoH\service-wrapper-link'
$junctionTarget=Join-Path $env:LAGOM_TEST_TEMP ('wj-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$null=New-Item -ItemType Directory -Path $junctionTarget
$null=New-Item -ItemType Junction -Path $link -Target $junctionTarget
Expect-Refused { Assert-PlainWrapperMigrationPath -Path (Join-Path $link 'wrapper.exe') -Root $script:RuntimeRoot } '*refuses reparse points*'
Write-Output 'PASS: migration refuses a real junction before reading or writing outside paths'
Expect-Refused { Assert-PlainWrapperMigrationPath -Path (Join-Path $fixtureRoot 'outside.exe') -Root $script:RuntimeRoot } '*outside its owned root*'
Write-Output 'PASS: an outside destination is rejected'

Update-PreservedSystemDohEngine $state
Require ((Get-FileSha256 $engine) -eq $engineHash -and (Get-FileSha256 $privateConfig) -eq $privateConfigHash) 'Already new engine was not idempotent.'
Write-Output 'PASS: exact new engine is idempotent without config changes'
function Reset-Engine {Copy-Item -LiteralPath $engineBackup -Destination $engine -Force;$script:statuses['EgoistShieldSystemDoH']='Stopped';$script:liveEngine=$false;Reset-Manifest}
Reset-Engine
$oldEngineHash=Get-FileSha256 $engine
$script:statuses['EgoistShieldSystemDoH']='Running'
Expect-Refused {Update-PreservedSystemDohEngine $state} '*requires stopped service*'
$script:statuses['EgoistShieldSystemDoH']='Stopped';$script:liveEngine=$true
Expect-Refused {Update-PreservedSystemDohEngine $state} '*requires no running owned engine*'
Require ((Get-FileSha256 $engine) -eq $oldEngineHash) 'Live runtime refusal changed the engine.'
$script:liveEngine=$false
Write-Output 'PASS: running service or surviving engine cannot authorize replacement'
$inventory=Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
$inventory.files[0].sha256='0'*64;Write-JsonAtomic -Path $inventoryPath -Value $inventory
Expect-Refused {Update-PreservedSystemDohEngine $state} '*host-integrity validation*'
Require ((Get-FileSha256 $engine) -eq $oldEngineHash) 'Wrong host digest changed the engine.'
Reset-Manifest
Write-Output 'PASS: wrong installed manifest digest is rejected'
$manifest.packageVersion='3.7.9';Reset-Manifest
Expect-Refused {Update-PreservedSystemDohEngine $state} '*not the installed release*'
Require ((Get-FileSha256 $engine) -eq $oldEngineHash) 'Stale version changed the engine.'
$manifest.packageVersion='3.8.0';Reset-Manifest
Write-Output 'PASS: stale engine package version is rejected'
[IO.File]::AppendAllText($engineSource,'tampered')
Expect-Refused {Update-PreservedSystemDohEngine $state} '*checksum validation*'
Require ((Get-FileSha256 $engine) -eq $oldEngineHash) 'Wrong shipped engine digest changed the runtime.'
[IO.File]::WriteAllText($engineSource,'New shipped engine sentinel; never executed.')
Write-Output 'PASS: shipped engine checksum mismatch is rejected'
$oldPath=$records[0].pathName;$records[0].pathName='C:\Foreign\wrapper.exe'
Expect-Refused {Update-PreservedSystemDohEngine $state} '*saved service ownership mismatch*'
$records[0].pathName=$oldPath
[IO.File]::WriteAllText($engine,'Foreign current engine sentinel; never executed.')
Expect-Refused {Update-PreservedSystemDohEngine $state} '*not the preserved or new verified binary*'
Require ([IO.File]::ReadAllText($engine) -eq 'Foreign current engine sentinel; never executed.' -and (Get-FileSha256 $privateConfig) -eq $privateConfigHash) 'Ownership refusal changed engine or private config.'
Reset-Engine
Write-Output 'PASS: foreign service path or current engine is rejected before replacement'
# Inject only the final digest observation, after the real atomic replacement.
$script:originalEngineHashFunction=(Get-Command Get-FileSha256).ScriptBlock
$script:rejectNewEngineReadback=$true
function Get-FileSha256 {
  param([string]$Path)
  $hashValue=& $script:originalEngineHashFunction $Path
  if($script:rejectNewEngineReadback -and $Path -eq $engine -and $hashValue -eq $engineHash){return ('0'*64)}
  return $hashValue
}
Expect-Refused {Update-PreservedSystemDohEngine $state} '*New SystemDoH engine failed checksum readback*'
$script:rejectNewEngineReadback=$false
Require ((Get-FileSha256 $engine) -eq $engineHash -and $state.wrapperMigrationPending -eq $true) 'Fixture did not exercise a replaced engine with pending rollback.'
Require ((Get-Content -LiteralPath (Join-Path $StageDirectory 'state.json') -Raw | ConvertFrom-Json).wrapperMigrationPending -eq $true) 'Rollback marker was not durable before engine replacement.'
# Execute the actual restoration body with only SCM/DNS and owned directory-copy adapters.
$restoreBody=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Restore-PreservedState'},$true)
. ([scriptblock]::Create($restoreBody.Extent.Text))
function Assert-PreservedServiceRegistration {param($Record)}
function Get-PreservedRegistryBackup {param($Record)}
function Assert-CurrentPreservedServiceOwnership {param($Name)}
function Restore-PreservedServiceRegistration {param($Record)}
function Restore-CriticalDnsState {param($State)}
function Protect-InstallerStageTree {
  param($Stage)
  Require ([IO.Path]::GetFullPath($Stage).StartsWith($fixtureRoot+'\',[StringComparison]::OrdinalIgnoreCase)) 'Restoration protection escaped the fixture.'
}
function Invoke-RobocopyDirectory {
  param($Source,$Destination,$ExcludeDirectories)
  Require ($Source -eq (Join-Path $StageDirectory 'runtime-backup') -and $Destination -eq $script:RuntimeRoot) 'Restoration copy escaped its exact fixture roots.'
  foreach($file in @(Get-ChildItem -LiteralPath $Source -Recurse -File)) {
    $target=Join-Path $Destination ($file.FullName.Substring($Source.Length+1))
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
}
$state | Add-Member -NotePropertyName userState -NotePropertyValue @() -Force
Copy-Item -LiteralPath $privateConfig -Destination (Join-Path $StageDirectory 'runtime-backup\SystemDoH\config.json')
Restore-PreservedState $state
Require ((Get-FileSha256 $engine) -eq $oldEngineHash -and (Get-FileSha256 $privateConfig) -eq $privateConfigHash) 'Actual restore body did not recover the old engine and private config after pending replacement failure.'
Require (@(Get-ChildItem -LiteralPath (Split-Path -Parent $engine) -Filter '*.migration-*').Count -eq 0) 'Engine temporary file leaked after failure.'
Write-Output 'PASS: final engine readback failure retains pending rollback and actual restore body recovers old engine/config'
Write-Output 'SystemDoH engine migration checks: 8 passed; real isolated atomic copy/restore, controlled SCM/protection adapters; no engine execution'
$script:frameworkRelease=0
function Get-ServiceFrameworkRelease { return $script:frameworkRelease }
foreach ($release in @(0,461808,528039)) { $script:frameworkRelease=$release; Expect-Refused { Assert-SupportedServiceFramework } '*Framework 4.8 or newer*' }
foreach ($release in @(528040,533509)) { $script:frameworkRelease=$release; Assert-SupportedServiceFramework }
Write-Output 'PASS: missing or older framework fails; exact 4.8 threshold and 4.8.1 pass'
$script:recoveryCalls=0; $script:snapshotCalls=0
function Test-IsAdministrator { return $true }
function Get-ValidatedRelease { return [pscustomobject]@{installer='unused'} }
function Add-ReceiptEvent { }
function Write-DesktopUpdateResult { }
function Invoke-Recovery { $script:recoveryCalls++ }
function Start-Sleep { }
function Resume-InterruptedServiceMaintenance { }
function Test-InstallerServiceMaintenanceOwner { return $false }
function Get-OwnedServiceSnapshot { $script:snapshotCalls++; throw 'Fixture snapshot rejection before backup' }
$workerState=[pscustomobject]@{installer='unused';manifest='unused';version='3.8.0';sha256=$hash;delaySeconds=0;handoffStarted=$false}
Write-JsonAtomic -Path (Join-Path $StageDirectory 'state.json') -Value $workerState
$script:frameworkRelease=0; $script:stops=@()
Expect-Refused { Invoke-WorkerMode } '*Framework 4.8 or newer*'
Require ($script:snapshotCalls -eq 0 -and $script:recoveryCalls -eq 0 -and $script:stops.Count -eq 0) 'Framework preflight triggered a snapshot, recovery or service stop.'
Write-Output 'PASS: actual worker refuses unsupported framework before every backup and stop'
$script:frameworkRelease=533509
Expect-Refused { Invoke-WorkerMode } '*Fixture snapshot rejection*'
Require ($script:snapshotCalls -eq 1 -and $script:recoveryCalls -eq 0 -and $script:stops.Count -eq 0) 'Pre-handoff failure invoked service recovery without a completed backup.'
Write-Output 'PASS: actual worker snapshot failure does not stop Core or invoke recovery'
Write-Output 'Wrapper migration checks: 21 passed; only isolated files and stubbed service operations'
