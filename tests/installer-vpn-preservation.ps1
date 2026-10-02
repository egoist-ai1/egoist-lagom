param([Parameter(Mandatory=$true)][string]$TempRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Production installer helper does not parse.'}
foreach($name in @('Restore-PreservedState','Assert-PlainWrapperMigrationPath','Wait-OwnedVpnReady')){
  $function=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if(-not $function){throw "Missing production function $name"}
  . ([scriptblock]::Create($function.Extent.Text))
}
$caseRoot=Join-Path ([IO.Path]::GetFullPath($TempRoot)) ('v'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$script:StageDirectory=Join-Path $caseRoot 'Stage'
$script:RuntimeRoot=Join-Path $caseRoot 'Product\Runtime'
$script:OwnedInstallRoot=Join-Path $caseRoot 'Install'
$script:privateCalls=[Collections.Generic.List[string]]::new()
$script:copyCalls=0
function Protect-InstallerStageTree {param($Stage)$script:privateCalls.Add([IO.Path]::GetFullPath($Stage))}
function Restore-CriticalDnsState {param($State)}
function Invoke-RobocopyDirectory {
  param($Source,$Destination)
  $script:copyCalls++
  foreach($name in @('Vpn','TelegramProxy')){
    $private=Join-Path $Destination $name
    if(-not $script:privateCalls.Contains([IO.Path]::GetFullPath($private))){throw 'Secret copy preceded private-directory protection.'}
    [IO.File]::Copy((Join-Path $Source "$name\config.json"),(Join-Path $private 'config.json'),$true)
  }
}
foreach($name in @('Vpn','TelegramProxy')){
  $directory=Join-Path $script:StageDirectory "runtime-backup\$name"
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $directory 'config.json'),'Own synthetic sentinel; not an account secret.')
}
Restore-PreservedState ([pscustomobject]@{services=@();userState=@()})
if($script:copyCalls -ne 1 -or $script:privateCalls.Count -ne 2){throw 'Private component restoration coverage mismatch.'}
foreach($name in @('Vpn','TelegramProxy')){
  if([IO.File]::ReadAllText((Join-Path $script:RuntimeRoot "$name\config.json")) -ne 'Own synthetic sentinel; not an account secret.'){throw 'Own preserved sentinel changed.'}
}
$helper=Join-Path $script:OwnedInstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'
New-Item -ItemType Directory -Path (Split-Path -Parent $helper) -Force | Out-Null
[IO.File]::WriteAllText($helper,'Own file identity fixture; never executed.')
$script:nativeCalls=0;$script:answers=@();$script:fixedAnswer=$null
function Invoke-InstallerNativeProcess {
  param($Executable,$Arguments,$TimeoutSeconds)
  if($Executable -ne $helper -or $Arguments.Count -ne 1 -or $Arguments[0] -ne '--vpn-service-status' -or $TimeoutSeconds -ne 15){throw 'Installer VPN probe invoked an unexpected capability.'}
  $script:nativeCalls++
  if($script:fixedAnswer){return $script:fixedAnswer}
  return $script:answers[$script:nativeCalls-1]
}
$good=@{serviceName='EgoistShieldVpn';serviceInstalled=$true;serviceState='running';running=$true;localHealth='responsive';observation=@{state='observed'};socksPort=10838;pid=42}
function Answer($Value,$Exit=0){[pscustomobject]@{exitCode=$Exit;output=($Value|ConvertTo-Json -Depth 5 -Compress);errors=''}}
$passes=2
foreach($change in @(
  @{serviceName='ForeignVpn'},@{serviceInstalled=$false},@{serviceState='start_pending'},@{running=$null},
  @{localHealth='conflict'},@{observation=@{state='unknown'}},@{socksPort=10808},@{pid=0}
)){
  $bad=$good.Clone();foreach($key in $change.Keys){$bad[$key]=$change[$key]}
  $script:nativeCalls=0;$script:answers=@((Answer $bad),(Answer $good))
  if(-not (Wait-OwnedVpnReady -TimeoutSeconds 2) -or $script:nativeCalls -ne 2){throw 'An incomplete or foreign VPN observation counted as readiness.'}
  $passes++
}
$script:nativeCalls=0;$script:answers=@((Answer $good 1),(Answer $good))
if(-not (Wait-OwnedVpnReady -TimeoutSeconds 2) -or $script:nativeCalls -ne 2){throw 'Failed Core probe exit counted as readiness.'};$passes++
$script:nativeCalls=0;$script:answers=@([pscustomobject]@{exitCode=0;output='not-json';errors=''},(Answer $good))
if(-not (Wait-OwnedVpnReady -TimeoutSeconds 2) -or $script:nativeCalls -ne 2){throw 'Malformed Core probe counted as readiness.'};$passes++
$script:fixedAnswer=Answer (@{serviceName='EgoistShieldVpn';serviceInstalled=$null;serviceState='unknown';running=$null;localHealth='unknown';observation=@{state='unknown'};socksPort=10838;pid=0})
if(Wait-OwnedVpnReady -TimeoutSeconds 1){throw 'Unresolved VPN readiness must fail after its bounded wait.'};$passes++
$cleanupAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $project 'src\installer\owned-cleanup.ps1'),[ref]$tokens,[ref]$errors)
function Get-ProtectedSystemDohPayloadContinuity {return $null}
if($errors.Count){throw 'Production cleanup helper does not parse.'}
foreach($name in @('Get-OwnedRuntimeDirectories','Remove-OwnedRuntimeDirectories','Assert-PlainOwnedDirectoryTree','Join-IfSet')){
  $function=$cleanupAst.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if(-not $function){throw "Missing production cleanup function $name"}
  . ([scriptblock]::Create($function.Extent.Text))
}
$programDataRoot=Join-Path $caseRoot 'UninstallProduct'
$localAppDataRoot='';$roamingAppDataRoot=''
$privateState=Join-Path $programDataRoot 'EgoistShield\Service\Vpn'
$Phase='PreInstall'
if(@(Get-OwnedRuntimeDirectories) -contains $privateState){throw 'Upgrade cannot discard the private VPN connection.'};$passes++
$Phase='Uninstall'
if(@(Get-OwnedRuntimeDirectories) -notcontains $privateState){throw 'Full uninstall must include its dedicated VPN state.'};$passes++
New-Item -ItemType Directory -Path $privateState -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $privateState 'connection.json'),'Own removal sentinel.')
$sibling=Join-Path (Split-Path -Parent $privateState) 'user-preserved.txt'
[IO.File]::WriteAllText($sibling,'Own sibling must remain.')
function Assert-OwnedPath {
  param($Path,$Because)
  $candidate=[IO.Path]::GetFullPath($Path)
  if(-not $candidate.StartsWith(([IO.Path]::GetFullPath($caseRoot)+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Fixture deletion escaped its task-owned directory.'}
  return $candidate
}
$script:remainingRegistration=$true
function Get-InstallerServiceState {param($Name)if($Name -ne 'EgoistShieldVpn'){throw 'Unexpected SCM fixture query.'};if($script:remainingRegistration){return [pscustomobject]@{ServiceName=$Name;Status='Stopped'}}}
$refused=$false
try{Remove-OwnedRuntimeDirectories}catch{$refused=$_.Exception.Message -like '*registration remains*'}
if(-not $refused -or -not (Test-Path -LiteralPath (Join-Path $privateState 'connection.json'))){throw 'Private state was discarded while a service registration remained.'};$passes++
$script:remainingRegistration=$false
Remove-OwnedRuntimeDirectories
if((Test-Path -LiteralPath $privateState) -or -not (Test-Path -LiteralPath $sibling)){throw 'Private uninstall removal exceeded its exact dedicated directory.'};$passes++
[pscustomobject]@{passes=$passes;actualProductionFunctions=$true;ownSentinelFiles=$true;ownDedicatedDirectoryRemoved=$true;mockedAclBoundary=$true;mockedNativeStatusBoundary=$true;mockedScmBoundary=$true;nativeAclChanges=0;serviceMutations=0;executedInstallers=0;scope='Private-directory-before-copy ordering, strict bounded readiness, and own dedicated-state removal after SCM absence only'}|ConvertTo-Json -Compress
