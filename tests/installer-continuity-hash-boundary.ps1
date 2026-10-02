param([Parameter(Mandatory=$true)][string]$TestDirectory,[string]$SourcePath='',[switch]$ExpectBaselineFailure)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
$root=[IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
Require ((Split-Path -Leaf $root) -like 'lagom-continuity-hash-boundary-*') 'Use a task-owned hash fixture directory.'
# Leave room for the fixed production inventory under native PS5 path limits.
Require ($root.Length -le 145) 'Own fixture root is too deep for native PowerShell 5 file APIs.'
if(-not $SourcePath){$SourcePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'}
function Parse-Source([string]$Path){$tokens=$null;$errors=$null;$a=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors);Require ($errors.Count -eq 0) 'Source failed native PowerShell parsing.';return $a}
function Find-Function($Ast,[string]$Name){return $Ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name},$true)}
$cleanup=Parse-Source $SourcePath
$worker=Parse-Source (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\invoke-final-silent-reinstall.ps1')
$boot=Parse-Source (Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\maintenance-boot-recovery.ps1')
$workerFunction=Find-Function $worker 'Get-FileSha256'
# The actual worker body runs in its own invocation scope. It cannot replace
# the separately imported cleanup function with the same production name.
$script:workerHash=$workerFunction.Body.GetScriptBlock()
function Get-WorkerFileSha256([string]$Path){return & $script:workerHash -Path $Path}
foreach($name in @('Get-FileSha256','Resolve-NormalizedPath','Get-ExecutableFromCommandLine','Assert-ProtectedSystemDohPayloadLease','Get-ProtectedSystemDohPayloadContinuity','Close-ProtectedSystemDohPayloadContinuity','Test-SystemDohContinuitySha256')){
  $fn=Find-Function $cleanup $name
  if(-not $fn){Require ($name -eq 'Test-SystemDohContinuitySha256' -and $ExpectBaselineFailure) ('Missing function '+$name);continue}
  . ([scriptblock]::Create(("`r`n"*($fn.Extent.StartLineNumber-1))+$fn.Extent.Text))
}
$plain=Find-Function $boot 'Assert-InstallerBootRecoveryPlainPath'
. ([scriptblock]::Create($plain.Extent.Text))
$script:positive=0;$script:negative=0;$script:helperCases=0;$script:liveMutations=0
$savedStage=$env:EGOIST_PROTECTED_REINSTALL_STAGE
$Phase='PreInstall'
function Test-VerifiedProtectedReinstall {return $script:verified}
function Assert-InstallerBootRecoveryFileProtection {param($Path,[switch]$Directory)Require ([IO.Path]::GetFullPath($Path).StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) 'Protection boundary escaped own fixture.'}
function Invoke-ProtectedSystemDohContinuityProbe {param($Stage)return $script:fixtureLease.proof}
function Get-Process {param($Id,$ErrorAction)return @($script:fixtureLease.processes|Where-Object {$_.Id -eq $Id})[0]}
function Get-CimInstance {
  [CmdletBinding()]param([Parameter(Position=0)][string]$ClassName,$Filter,$Namespace,$OperationTimeoutSec)
  switch($ClassName){'Win32_Service'{return $script:service};'MSFT_NetUDPEndpoint'{return $script:udp};'MSFT_NetTCPConnection'{return $script:tcp};default{throw 'Forbidden native CIM boundary.'}}
}
function Write-Journal {param($Stage,$Extra)}
foreach($name in @('Start-Process','Stop-Process','Start-Service','Stop-Service','Set-Service','Get-Service','Set-DnsClientServerAddress','Resolve-DnsName','New-ItemProperty','Set-ItemProperty','Remove-ItemProperty','Register-ScheduledTask','Unregister-ScheduledTask','sc.exe','reg.exe','takeown.exe','netsh.exe')){
  Set-Item -Path ('Function:\'+$name) -Value ([scriptblock]::Create('$script:liveMutations++;throw ''Forbidden live mutation/read boundary.'''))
}
function New-Fixture([string]$Name) {
  Remove-Variable -Name protectedSystemDohPayloadLease -Scope Script -ErrorAction SilentlyContinue
  $case=Join-Path $root $Name
  $script:programDataRoot=Join-Path $case 'data'
  $component=Join-Path $script:programDataRoot 'EgoistShield\Runtime\SystemDoH'
  $stage=Join-Path $case 'stage'
  foreach($path in @($stage,(Join-Path $component 'service-wrapper'),(Join-Path $component 'runtime'))){[void][IO.Directory]::CreateDirectory($path)}
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$stage
  $relative=@('config.json','service-wrapper\egoistshield-system-doh-service.exe','service-wrapper\egoistshield-system-doh-service.xml','runtime\xray-system-doh.exe')
  $files=@()
  foreach($item in $relative) {
    $path=Join-Path $component $item
    $text=if($item -eq 'config.json'){'{"fixture":true}'.PadRight(1456,' ')}else{'inert hash boundary fixture '+$item}
    [IO.File]::WriteAllText($path,$text,(New-Object Text.UTF8Encoding($false)))
    $files += [pscustomobject]@{path=$item;bytes=(Get-Item -LiteralPath $path).Length;sha256=(Get-WorkerFileSha256 $path)}
  }
  $activation=@()
  foreach($name in @('intent.json','intent.json.bak')){
    $path=Join-Path $case $name
    [IO.File]::WriteAllText($path,'{"fixture":true,"enabled":true}',(New-Object Text.UTF8Encoding($false)))
    $activation += [pscustomobject]@{path=$path;sha256=(Get-WorkerFileSha256 $path)}
  }
  $journal=Join-Path $case 'dns-owned-state.json'
  [IO.File]::WriteAllText($journal,'{"fixture":true}',(New-Object Text.UTF8Encoding($false)))
  $state=Join-Path $stage 'state.json'
  [IO.File]::WriteAllText($state,'{"payloadContinuity":{"fixture":true}}',(New-Object Text.UTF8Encoding($false)))
  $wrapper=Join-Path $component $relative[1];$engine=Join-Path $component $relative[3]
  $start=[DateTime]::SpecifyKind([DateTime]'2026-01-01T00:00:00',[DateTimeKind]::Utc)
  $processes=@()
  foreach($pair in @(@(101,$wrapper),@(102,$engine))){
    $process=[pscustomobject]@{Id=$pair[0];Handle=1;HasExited=$false;StartTime=$start;MainModule=[pscustomobject]@{FileName=$pair[1]}}
    $process|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
    $processes += $process
  }
  $proof=[pscustomobject]@{schemaVersion=1;purpose='private-dns-payload-continuity';root=$component;wrapper=$wrapper;engine=$engine;config=(Join-Path $component $relative[0]);files=$files;activation=$activation;ownedDns=[pscustomobject]@{path=$journal;digest=(Get-WorkerFileSha256 $journal)};wrapperPid=101;enginePid=102;wrapperStartTicks=[string]$start.Ticks;engineStartTicks=[string]$start.Ticks;listeners=@('127.0.0.1')}
  $script:fixtureLease=[pscustomobject]@{stage=$stage;proof=$proof;stateSha256=(Get-FileSha256 $state);processes=$processes;streams=@()}
  $script:verified=$true
  $script:service=[pscustomobject]@{State='Running';ProcessId=101;StartName='LocalSystem';PathName=('"'+$wrapper+'"')}
  $script:udp=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=102})
  $script:tcp=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=102})
}
function Set-HashCase([string]$Case) {
  foreach($file in @($script:fixtureLease.proof.files)+@($script:fixtureLease.proof.activation)){$file.sha256=Convert-HashCase $file.sha256 $Case}
  $script:fixtureLease.proof.ownedDns.digest=Convert-HashCase $script:fixtureLease.proof.ownedDns.digest $Case
}
function Convert-HashCase([string]$Hash,[string]$Case){
  if($Case -eq 'lower'){return $Hash.ToLowerInvariant()}
  if($Case -eq 'upper'){return $Hash.ToUpperInvariant()}
  $chars=$Hash.ToLowerInvariant().ToCharArray();for($i=0;$i -lt $chars.Length;$i+=2){$chars[$i]=[char]::ToUpperInvariant($chars[$i])};return -join $chars
}
function Pass-Direct([string]$Name){[void](Assert-ProtectedSystemDohPayloadLease $script:fixtureLease);$script:positive++;Write-Output ('PASS '+$Name)}
function Reject-Direct([string]$Name,[scriptblock]$Change,[string]$Reason,[switch]$Acquire){
  New-Fixture ('negative-'+$script:negative)
  & $Change
  $rejected=$false
  try {if($Acquire){$lease=Get-ProtectedSystemDohPayloadContinuity;Close-ProtectedSystemDohPayloadContinuity $lease}else{[void](Assert-ProtectedSystemDohPayloadLease $script:fixtureLease)}}
  catch {Require ($_.Exception.Message -eq $Reason) ('Unexpected rejection for '+$Name+': '+$_.Exception.Message);$rejected=$true}
  Require $rejected ('Accepted invalid '+$Name)
  $script:negative++;Write-Output ('PASS reject '+$Name)
}
try {
  New-Fixture 'producer-boundary'
  $config=$script:fixtureLease.proof.config
  $workerDigest=Get-WorkerFileSha256 $config;$cleanupDigest=Get-FileSha256 $config
  Require ($workerDigest -cmatch '\A[A-F0-9]{64}\z' -and $cleanupDigest -cmatch '\A[a-f0-9]{64}\z') 'Distinct real producer hash formats were lost.'
  Require ($workerDigest -cne $cleanupDigest -and [string]::Equals($workerDigest,$cleanupDigest,[StringComparison]::OrdinalIgnoreCase)) 'Actual producer and consumer digest boundary was not exercised.'
  if($ExpectBaselineFailure){
    $red=$false
    try {[void](Assert-ProtectedSystemDohPayloadLease $script:fixtureLease)}catch {
      Require ($_.Exception.Message -eq 'Private DNS continuity runtime generation changed.') 'Baseline failed outside the proven hash boundary.'
      Require ($_.InvocationInfo.ScriptLineNumber -eq 795) 'Baseline rejection was not the original line795.'
      $red=$true
    }
    Require $red 'Baseline unexpectedly accepted uppercase worker proof.'
    Require ($script:liveMutations -eq 0) 'Baseline reached a live boundary.'
    Write-Output 'EXPECTED RED: identical config1456 bytes; actual worker uppercase vs cleanup lowercase; runtime generation changed at line795; live mutations 0'
    exit 0
  }
  $lease=Get-ProtectedSystemDohPayloadContinuity
  Require ($lease.streams.Count -eq 8 -and $lease.processes.Count -eq 2) 'Actual lease acquisition did not retain all own files and process boundaries.'
  [void](Assert-ProtectedSystemDohPayloadLease $lease)
  Close-ProtectedSystemDohPayloadContinuity $lease
  $script:positive++;Write-Output 'PASS actual acquisition with worker proof'
  foreach($case in @('upper','lower','mixed')){New-Fixture ('positive-'+$case);Set-HashCase $case;Pass-Direct ($case+' external inventory/intent/journal')}
  $valid=$cleanupDigest
  $bad=@(
    [pscustomobject]@{name='null';value=$null},[pscustomobject]@{name='empty';value=''},
    [pscustomobject]@{name='length63';value=('a'*63)},[pscustomobject]@{name='length65';value=('a'*65)},
    [pscustomobject]@{name='nonhex';value=('g'*64)},[pscustomobject]@{name='fullwidth';value=([string][char]0xff41)*64},
    [pscustomobject]@{name='LF';value=($valid+"`n")},[pscustomobject]@{name='space';value=(' '+$valid)},
    [pscustomobject]@{name='number';value=1},[pscustomobject]@{name='boolean';value=$true},
    [pscustomobject]@{name='array';value=@($valid)},[pscustomobject]@{name='object';value=[pscustomobject]@{digest=$valid}}
  )
  foreach($case in @('upper','lower','mixed')){Require (Test-SystemDohContinuitySha256 -Actual $valid -Expected (Convert-HashCase $valid $case)) 'Valid helper case rejected.';$script:helperCases++}
  foreach($item in $bad){
    Require (-not (Test-SystemDohContinuitySha256 -Actual $valid -Expected $item.value)) ('Helper accepted expected '+$item.name)
    Require (-not (Test-SystemDohContinuitySha256 -Actual $item.value -Expected $valid)) ('Helper accepted actual '+$item.name)
    $script:helperCases+=2
    foreach($field in @('files','activation','ownedDns')){
      $change={switch($field){'files'{$script:fixtureLease.proof.files[0].sha256=$item.value};'activation'{$script:fixtureLease.proof.activation[0].sha256=$item.value};'ownedDns'{$script:fixtureLease.proof.ownedDns.digest=$item.value}}}
      $reason=switch($field){'files'{'Private DNS continuity runtime generation changed.'};'activation'{'Private DNS continuity enabled intent changed.'};'ownedDns'{'Private DNS continuity DNS journal changed.'}}
      Reject-Direct ($field+'-'+$item.name) $change $reason
    }
  }
  Reject-Direct 'same-length-config-bytes' {[IO.File]::WriteAllText($script:fixtureLease.proof.config,('{"fixture":false}'.PadRight(1456,' ')),(New-Object Text.UTF8Encoding($false)))} 'Private DNS continuity runtime generation changed.'
  Reject-Direct 'appended-config-bytes' {[IO.File]::AppendAllText($script:fixtureLease.proof.config,'x')} 'Private DNS continuity runtime generation changed.'
  Reject-Direct 'wrong-config-length' {$script:fixtureLease.proof.files[0].bytes++} 'Private DNS continuity runtime generation changed.'
  foreach($index in @(0,1)){Reject-Direct ('intent-bytes-'+$index) {[IO.File]::AppendAllText($script:fixtureLease.proof.activation[$index].path,'x')} 'Private DNS continuity enabled intent changed.'}
  Reject-Direct 'journal-bytes' {[IO.File]::AppendAllText($script:fixtureLease.proof.ownedDns.path,'x')} 'Private DNS continuity DNS journal changed.'
  Reject-Direct 'local-state-uppercase-remains-strict' {$script:fixtureLease.stateSha256=$script:fixtureLease.stateSha256.ToUpperInvariant()} 'Private DNS continuity protected snapshot changed.'
  Reject-Direct 'local-state-bytes' {[IO.File]::AppendAllText((Join-Path $script:fixtureLease.stage 'state.json'),' ')} 'Private DNS continuity protected snapshot changed.'
  Reject-Direct 'unverified-transaction' {$script:verified=$false} 'Private DNS continuity transaction lease changed.'
  Reject-Direct 'changed-stage' {$script:fixtureLease.stage=Join-Path $root 'wrong-stage'} 'Private DNS continuity transaction lease changed.'
  foreach($index in @(0,1)){
    Reject-Direct ('held-process-exit-'+$index) {$script:fixtureLease.processes[$index].HasExited=$true} 'Private DNS continuity held process changed.'
    Reject-Direct ('held-process-start-'+$index) {$script:fixtureLease.processes[$index].StartTime=$script:fixtureLease.processes[$index].StartTime.AddSeconds(1)} 'Private DNS continuity held process changed.'
    Reject-Direct ('held-process-image-'+$index) {$script:fixtureLease.processes[$index].MainModule.FileName=Join-Path $root 'wrong-inert-image.exe'} 'Private DNS continuity held process changed.'
  }
  Reject-Direct 'service-pid' {$script:service.ProcessId=103} 'Private DNS continuity service ownership changed.'
  Reject-Direct 'service-account' {$script:service.StartName='fixture-other'} 'Private DNS continuity service ownership changed.'
  Reject-Direct 'service-image' {$script:service.PathName='"'+(Join-Path $root 'wrong-inert-image.exe')+'"'} 'Private DNS continuity service ownership changed.'
  Reject-Direct 'service-state' {$script:service.State='Stopped'} 'Private DNS continuity service ownership changed.'
  Reject-Direct 'udp-owner' {$script:udp[0].OwningProcess=103} 'Private DNS continuity UDP/TCP listener ownership changed.'
  Reject-Direct 'tcp-owner' {$script:tcp[0].OwningProcess=103} 'Private DNS continuity UDP/TCP listener ownership changed.'
  Reject-Direct 'udp-missing' {$script:udp=@()} 'Private DNS continuity UDP/TCP listener ownership changed.'
  Reject-Direct 'tcp-missing' {$script:tcp=@()} 'Private DNS continuity UDP/TCP listener ownership changed.'
  Reject-Direct 'no-listener' {$script:fixtureLease.proof.listeners=@()} 'Private DNS continuity has no owned listener.'
  Reject-Direct 'foreign-listener' {$script:fixtureLease.proof.listeners=@('192.0.2.1')} 'Private DNS continuity listener is invalid.'
  Reject-Direct 'acquire-unverified-stage' {$script:verified=$false} 'Private DNS continuity stage is unverified.' -Acquire
  Reject-Direct 'acquire-wrong-root' {$script:fixtureLease.proof.root=Join-Path $root 'wrong-root'} 'Private DNS continuity proof is invalid.' -Acquire
  Reject-Direct 'acquire-wrong-count' {$script:fixtureLease.proof.files=@($script:fixtureLease.proof.files)[0..2]} 'Private DNS continuity proof is invalid.' -Acquire
  Reject-Direct 'acquire-same-pid' {$script:fixtureLease.proof.enginePid=101} 'Private DNS continuity proof is invalid.' -Acquire
  foreach($field in @('wrapper','engine','config')){
    Reject-Direct ('acquire-fixed-'+$field) {$script:fixtureLease.proof.$field=Join-Path $root 'wrong-fixed-leaf'} 'Private DNS continuity fixed path changed.' -Acquire
  }
  Reject-Direct 'acquire-inventory-relative-path' {$script:fixtureLease.proof.files[0].path='wrong.json'} 'Private DNS continuity fixed inventory is invalid.' -Acquire
  Require ($script:liveMutations -eq 0) 'Fixture attempted a live mutation.'
  Write-Output ('Installer continuity hash boundary: '+$script:positive+' positives, '+$script:negative+' negatives, '+$script:helperCases+' strict helper cases passed; actual worker/cleanup SHA functions; local state cne preserved; live mutations 0; native '+$PSVersionTable.PSVersion)
} finally {
  $cached=Get-Variable -Name protectedSystemDohPayloadLease -Scope Script -ErrorAction SilentlyContinue
  if($cached -and $cached.Value){Close-ProtectedSystemDohPayloadContinuity $cached.Value}
  $env:EGOIST_PROTECTED_REINSTALL_STAGE=$savedStage
}
