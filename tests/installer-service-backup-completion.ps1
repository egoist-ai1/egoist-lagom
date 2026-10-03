param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
if(-not (Split-Path -Leaf $root).StartsWith('lagom-service-backup-completion-')){throw 'Dedicated own completion fixture required.'}
function Check([bool]$Value,[string]$Reason){if(-not $Value){throw $Reason};[void]($script:checks++)}
$script:checks=0;$script:positive=0;$script:negative=0;$script:liveOperations=0;$script:closed=0
function Find-Function([string]$Path,[string]$Name){$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors);Check ($errors.Count -eq 0) 'Actual source parser failure.';$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$true);Check ([bool]$fn) ('Required actual AST missing: '+$Name);return $fn}
$cleanup=Join-Path $project 'src\installer\owned-cleanup.ps1'
$worker=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
$boot=Join-Path $project 'src\installer\maintenance-boot-recovery.ps1'
$cleanupBefore=(Get-FileHash -LiteralPath $cleanup -Algorithm SHA256).Hash
$workerBefore=(Get-FileHash -LiteralPath $worker -Algorithm SHA256).Hash
foreach($name in @('Initialize-ProtectedInstallerHeartbeatNative','Assert-PlainOwnedDirectoryTree','Test-SystemDohContinuitySha256','Invalidate-OwnedCoreAclHardeningCache')){$fn=Find-Function $cleanup $name;. ([scriptblock]::Create($fn.Extent.Text))}
$fn=Find-Function $boot 'Assert-InstallerBootRecoveryPlainPath';. ([scriptblock]::Create($fn.Extent.Text))
function New-OwnSecurity([switch]$Directory){
  $security=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
  $own=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $security.SetOwner($own);$security.SetAccessRuleProtection($true,$false)
  foreach($sid in @($own.Value,'S-1-5-18','S-1-5-32-544')){$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))}
  return $security
}
# Exactly the protected ACL authority changes to the own-user fixture. Native
# held ACL reads and all original ACL predicates continue to execute.
$policy=(Find-Function $cleanup 'Assert-ProtectedInstallerHeartbeatSecurity').Extent.Text
$trusted="`$trusted = @('S-1-5-18','S-1-5-32-544')"
Check ($policy.Contains($trusted)) 'Controlled ACL authority boundary changed.'
$policy=$policy.Replace($trusted,"`$trusted = @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value)")
. ([scriptblock]::Create($policy))
$binding=(Find-Function $cleanup 'Write-ProtectedScmBackupBinding').Extent.Text
$owner="`$security.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))"
$aces="foreach (`$sid in @('S-1-5-18','S-1-5-32-544'))"
Check ($binding.Contains($owner) -and $binding.Contains($aces)) 'Protected create-only ACL constructor boundary changed.'
$binding=$binding.Replace($owner,'$security.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)').Replace($aces,"foreach (`$sid in @('S-1-5-18','S-1-5-32-544',[Security.Principal.WindowsIdentity]::GetCurrent().User.Value))")
. ([scriptblock]::Create($binding))
function Assert-InstallerBootRecoveryFileProtection {
  param([string]$Path,[switch]$Directory)
  Check ([IO.Path]::GetFullPath($Path).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'Protection boundary escaped own fixture.'
  if($Directory){Initialize-ProtectedInstallerHeartbeatNative;$pin=[LagomInstallerHeartbeatSnapshotNative]::PinDirectory($Path);try{Assert-ProtectedInstallerHeartbeatSecurity -Acl ([LagomInstallerHeartbeatSnapshotNative]::ReadAcl($pin)) -Directory}finally{$pin.Dispose()}}
  else{Assert-ProtectedInstallerHeartbeatSecurity -Acl (Get-Acl -LiteralPath $Path)}
}
function Test-VerifiedProtectedReinstall {return $script:verified}
function Write-Journal {param($Stage,$Extra)}
function Add-ReceiptEvent {param($Stage,$Status,$Message,$Extra)}
foreach($name in @('Get-CimInstance','Get-Service','Start-Service','Stop-Service','Set-Service','Get-Process','Stop-Process','Set-DnsClientServerAddress','Get-DnsClientServerAddress','Clear-DnsClientCache','Register-ScheduledTask','Unregister-ScheduledTask','Get-ScheduledTask','Get-ItemProperty','Set-ItemProperty','Remove-ItemProperty','sc.exe','reg.exe','netsh.exe','takeown.exe')){Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create('$script:liveOperations++;throw ''Forbidden service/network/task/registry/process operation.'''))}
function Write-OwnedText([string]$Path,[string]$Text){[IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false));[IO.File]::SetAccessControl($Path,(New-OwnSecurity))}
function Own-Hash([string]$Path){return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()}
foreach($name in @('Assert-OwnedSystemDohInputSingleLink','Complete-InstallerScmBackupBarrier','Complete-InstallerServiceMaintenance')){$fn=Find-Function $worker $name;. ([scriptblock]::Create($fn.Extent.Text))}
function Assert-InstallerMaintenanceBootRecovery {param([string]$StageDirectory);Check ($StageDirectory -ceq $script:StageDirectory) 'Boot authority escaped the own registered stage.';return [pscustomobject]@{verified=$true;stage=$script:bootStage}}
function Test-InstallerServiceMaintenanceOwner {return $script:maintenanceOwned}
function Resume-OwnedGuiLoginStartup {Check (-not (Test-Path -LiteralPath $serviceBackupManifestPath) -and (Test-Path -LiteralPath $script:archive) -and -not (Test-Path -LiteralPath $script:maintenanceMarker)) 'Maintenance close preceded manifest completion.';[void]($script:closed++)}
function New-Fixture([string]$Name){
  $case=Join-Path $root $Name
  $script:programDataRoot=Join-Path $case 'data'
  $script:OwnedDataRoot=Join-Path $script:programDataRoot 'EgoistShield'
  $script:StageDirectory=Join-Path $case 'registered-stage'
  $script:serviceBackupDirectory=Join-Path $script:OwnedDataRoot 'installer\service-backup'
  $script:serviceBackupManifestPath=Join-Path $script:serviceBackupDirectory 'manifest.json'
  foreach($dir in @($script:StageDirectory,$script:serviceBackupDirectory)){[void][IO.Directory]::CreateDirectory($dir);[IO.Directory]::SetAccessControl($dir,(New-OwnSecurity -Directory))}
  $script:maintenanceMarker=Join-Path $script:OwnedDataRoot 'installer\service-maintenance.json'
  $script:archive=Join-Path $script:StageDirectory 'completed-service-backup-manifest.json'
  $script:bindingPath=Join-Path $script:StageDirectory 'service-backup-binding.json'
  Write-OwnedText $script:serviceBackupManifestPath '[{"name":"FixtureA","fileName":"service-0.reg"}]'
  Write-OwnedText $script:maintenanceMarker ('{"owner":"EgoistShield","stage":'+($script:StageDirectory|ConvertTo-Json -Compress)+'}')
  $script:preserved=@()
  foreach($name in @('service-0.reg','service-1.reg','private-dns-state.json','private-dns-intent.json')){$path=Join-Path $script:serviceBackupDirectory $name;Write-OwnedText $path ('inert preserved fixture '+$name);$script:preserved+=[pscustomobject]@{path=$path;sha256=(Own-Hash $path)}}
  $script:verified=$true;$script:bootStage=$script:StageDirectory;$script:maintenanceOwned=$true;$script:closed=0
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$script:StageDirectory
  Check (@(Write-ProtectedScmBackupBinding).Count -eq 0) 'Actual binding producer polluted success output.'
}
function Check-Preserved {foreach($entry in $script:preserved){Check ((Test-Path -LiteralPath $entry.path) -and (Own-Hash $entry.path) -ceq $entry.sha256) 'An unrelated REG/private DNS backup changed.'}}
function Reject-Completion([string]$Case,[scriptblock]$Change,[switch]$Missing){
  New-Fixture $Case
  & $Change
  $manifestHash=Own-Hash $serviceBackupManifestPath;$markerHash=Own-Hash $script:maintenanceMarker
  $rejected=$false
  try{Complete-InstallerServiceMaintenance}
  catch{
    if($Missing){Check ($_.CategoryInfo.Category -eq [Management.Automation.ErrorCategory]::ObjectNotFound) 'Missing binding was not rejected by its actual file guard.'}
    else{$expected=if($Case -eq 'foreign-stage'){'SCM completion stage is not authenticated.'}else{'SCM backup binding or generation changed.'};Check ($_.Exception.Message -ceq $expected) 'Completion failed outside the intended guard.'}
    $rejected=$true
  }
  Check $rejected 'Invalid completion was accepted.'
  Check ((Test-Path -LiteralPath $serviceBackupManifestPath) -and -not (Test-Path -LiteralPath $script:archive) -and (Own-Hash $serviceBackupManifestPath) -ceq $manifestHash) 'Refused completion moved or changed the SCM manifest.'
  Check ((Test-Path -LiteralPath $script:maintenanceMarker) -and (Own-Hash $script:maintenanceMarker) -ceq $markerHash -and $script:closed -eq 0) 'Refused completion closed maintenance.'
  Check-Preserved;[void]($script:negative++);Write-Output ('PASS reject '+$Case)
}
$savedStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE;$savedTemp=$env:TEMP;$savedTmp=$env:TMP
$compiler=Join-Path $root 'compiler';[void][IO.Directory]::CreateDirectory($compiler);$env:TEMP=$compiler;$env:TMP=$compiler
try{
  New-Fixture 'complete'
  $manifestHash=Own-Hash $serviceBackupManifestPath
  $record=Get-Content -LiteralPath $script:bindingPath -Raw|ConvertFrom-Json
  Check ($record.sha256 -ceq $manifestHash -and [long]$record.bytes -eq (Get-Item -LiteralPath $serviceBackupManifestPath).Length -and $record.stage -ceq $StageDirectory -and $record.manifest -ceq $serviceBackupManifestPath) 'Actual binding did not bind own exact bytes and paths.'
  $bindingHash=Own-Hash $script:bindingPath
  Check (@(Write-ProtectedScmBackupBinding).Count -eq 0 -and (Own-Hash $script:bindingPath) -ceq $bindingHash) 'Existing matching binding changed.'
  Check (@(Complete-InstallerServiceMaintenance).Count -eq 0) 'Actual completion polluted success output.'
  Check (-not (Test-Path -LiteralPath $serviceBackupManifestPath) -and (Test-Path -LiteralPath $script:archive) -and (Own-Hash $script:archive) -ceq $manifestHash) 'Actual same-volume manifest move did not preserve its bytes.'
  Check ($script:closed -eq 1 -and -not (Test-Path -LiteralPath $script:maintenanceMarker)) 'Maintenance did not close after confirmed completion.'
  Check-Preserved;[void]($script:positive++);Write-Output 'PASS actual bound manifest move before maintenance close'
  Reject-Completion 'changed-binding' {$v=Get-Content -LiteralPath $script:bindingPath -Raw|ConvertFrom-Json;$v.owner='fixture-other';Write-OwnedText $script:bindingPath ($v|ConvertTo-Json -Compress)}
  Reject-Completion 'changed-generation' {$v=[IO.File]::ReadAllText($serviceBackupManifestPath).Replace('FixtureA','FixtureB');Write-OwnedText $serviceBackupManifestPath $v}
  Reject-Completion 'changed-hash' {$v=Get-Content -LiteralPath $script:bindingPath -Raw|ConvertFrom-Json;$v.sha256='0'*64;Write-OwnedText $script:bindingPath ($v|ConvertTo-Json -Compress)}
  Reject-Completion 'foreign-stage' {$script:bootStage=Join-Path $root 'foreign-stage'}
  Reject-Completion 'missing-binding' {[IO.File]::Delete($script:bindingPath)} -Missing
  $script:programDataRoot=Join-Path (Join-Path $root 'cache') 'data'
  $cacheDir=Join-Path $script:programDataRoot 'EgoistShield\Service';[void][IO.Directory]::CreateDirectory($cacheDir)
  $cache=Join-Path $cacheDir 'acl-hardening.marker';$private=Join-Path $cacheDir 'private-dns-state.json'
  Write-OwnedText $private '{"fixture":"retained private DNS"}';$privateHash=Own-Hash $private
  Write-OwnedText $cache '4';$cacheHash=Own-Hash $cache
  Check (@(Invalidate-OwnedCoreAclHardeningCache).Count -eq 0) 'Cache invalidation polluted success output.'
  $archives=@(Get-ChildItem -LiteralPath $cacheDir -Filter 'acl-hardening.marker.invalidated-*')
  Check (-not (Test-Path -LiteralPath $cache) -and $archives.Count -eq 1 -and (Own-Hash $archives[0].FullName) -ceq $cacheHash) 'Exact version4 cache was not archived with unchanged bytes.'
  Check ((Own-Hash $private) -ceq $privateHash) 'Cache invalidation changed private DNS state.'
  [void]($script:positive++);Write-Output 'PASS exact own cache marker4 invalidation'
  Write-OwnedText $cache '3';$wrongHash=Own-Hash $cache
  Check (@(Invalidate-OwnedCoreAclHardeningCache).Count -eq 0) 'Unknown cache marker changed return contract.'
  Check ((Test-Path -LiteralPath $cache) -and (Own-Hash $cache) -ceq $wrongHash -and @(Get-ChildItem -LiteralPath $cacheDir -Filter 'acl-hardening.marker.invalidated-*').Count -eq 1 -and (Own-Hash $private) -ceq $privateHash) 'Unknown cache content was invalidated or changed private DNS state.'
  [void]($script:negative++);Write-Output 'PASS retain unknown cache marker'
  Check ($script:liveOperations -eq 0) 'Fixture reached a live product operation.'
  Check ((Get-FileHash -LiteralPath $cleanup -Algorithm SHA256).Hash -ceq $cleanupBefore -and (Get-FileHash -LiteralPath $worker -Algorithm SHA256).Hash -ceq $workerBefore) 'Production source changed during the isolated test.'
  Write-Output ('Installer service backup completion: '+$script:positive+' positives, '+$script:negative+' negatives; '+$script:checks+' checks passed')
  Write-Output ('actual own file hashing/single-link/move; service/network/tasks/registry operations 0; native '+$PSVersionTable.PSVersion)
  Write-Output 'controlled boot/current maintenance and own-user protected ACL constructor authority; actual maintenance close only on own marker'
}finally{$env:EGOIST_PROTECTED_REINSTALL_STAGE=$savedStage;$env:TEMP=$savedTemp;$env:TMP=$savedTmp}
