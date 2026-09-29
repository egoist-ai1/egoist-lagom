param(
  [string]$SourceScript=(Join-Path $PSScriptRoot '..\src\installer\owned-cleanup.ps1'),
  [ValidateSet('All','Version','Handoff')][string]$Case='All',
  [ValidateSet('','Existing','Unsafe','Fresh','Protected')][string]$SafetyScenario=''
)
$ErrorActionPreference='Stop'
if(-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)){throw 'Set task-scoped LAGOM_TEST_TEMP.'}
$fixture=Join-Path $env:LAGOM_TEST_TEMP ('vh [x]-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$installRoot=Join-Path $fixture 'EgoistShield'
$script:canonicalRoot=$installRoot
$null=New-Item -ItemType Directory -Path (Join-Path $installRoot 'resources\runtime') -Force
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath($SourceScript),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
foreach($name in @('Get-FileSha256','Write-Utf8NoBomFile','Test-InstallRootIdentified','Test-InstallRootHealthy','Test-EmptyPlainDirectory','Assert-PlainInstallerCandidatePath','Test-CanonicalInstallerTarget','Get-ValidatedInstalledProductVersion','Test-VerifiedCanonicalInstalledApplication','Write-ValidatedInstallationIdentity','Test-InstallMayStopOwnedRuntimes')){
  $fn=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if($fn){. ([scriptblock]::Create($fn.Extent.Text))}
}
function Require {param([bool]$Value,[string]$Message)if(-not $Value){throw $Message}}
function Refused {param([scriptblock]$Action) $failed=$false;try{& $Action}catch{$failed=$true};Require $failed 'Unverified metadata was accepted.'}
function Get-CanonicalInstallerRoot {return $script:canonicalRoot}
$script:protected=$false;$script:dnsFailure=$false
function Test-VerifiedProtectedReinstall {return $script:protected}
function Test-RunningOwnedSystemDoh {if($script:dnsFailure){throw 'Fixture DNS query failed'};return $false}
$installIdentityRequiredFiles=@('EgoistShield.exe','resources\app.asar')
$installHealthRequiredFiles=@('EgoistShield.exe','resources\app.asar','resources\runtime\manifest.json')
[IO.File]::WriteAllText((Join-Path $installRoot 'resources\app.asar'),'isolated fixture')
$resource=Join-Path $fixture 'fixture.bin';[IO.File]::WriteAllBytes($resource,(New-Object byte[] 1048576))
$csc=Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
function Write-CandidatePE {
  param([string]$Product='Egoist Lagom',[string]$Version='3.8.0')
  $cs=Join-Path $fixture 'version.cs'
  [IO.File]::WriteAllText($cs,('using System.Reflection;[assembly:AssemblyProduct("'+$Product+'")][assembly:AssemblyFileVersion("'+$Version+'.0")][assembly:AssemblyInformationalVersion("'+$Version+'")]class Fixture{static void Main(){}}'))
  $compilerOutput=& $csc /nologo /target:exe ("/out:"+(Join-Path $installRoot 'EgoistShield.exe')) ("/resource:"+$resource) $cs 2>&1
  $compilerExit=$LASTEXITCODE
  [IO.File]::WriteAllText((Join-Path $fixture 'compiler.log'),($compilerOutput|Out-String))
  if($compilerExit -ne 0){throw 'Could not compile the harmless isolated versioned PE.'}
}
Write-CandidatePE
$components=@()
foreach($name in @('xray','sing-box','zapret','tg-ws-proxy')){
  $relative=$name+'/fixture.bin';$path=Join-Path (Join-Path $installRoot 'resources\runtime') $relative
  $null=New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force
  [IO.File]::WriteAllText($path,'fixture-'+$name)
  $components += @{name=$name;present=$true;fileCount=1;files=@(@{path=$relative;sha256=Get-FileSha256 $path})}
}
$profiles=Join-Path $installRoot 'resources\runtime\zapret\core';$null=New-Item -ItemType Directory -Path $profiles
1..10|ForEach-Object{[IO.File]::WriteAllText((Join-Path $profiles ("profile$_.bat")),'fixture')}
$manifestPath=Join-Path $installRoot 'resources\runtime\manifest.json'
$manifest=@{schemaVersion=1;packageVersion='3.8.0';components=$components}
function Save-Manifest {$manifest|ConvertTo-Json -Depth 16|Set-Content -LiteralPath $manifestPath -Encoding utf8}
Save-Manifest
$phases=$ast.Find({param($node)$node -is [Management.Automation.Language.SwitchStatementAst] -and $node.Condition.Extent.Text -eq '$Phase'},$true)
if($Case -eq 'Handoff'){$SafetyScenario='Unsafe'}
if($SafetyScenario){
  if($SafetyScenario -eq 'Unsafe'){Write-CandidatePE -Product 'Foreign Application'}
  if($SafetyScenario -eq 'Fresh'){$installRoot=Join-Path $fixture 'fresh';$script:canonicalRoot=$installRoot}
  if($SafetyScenario -eq 'Protected'){$script:protected=$true}
  $safety=@($phases.Clauses|Where-Object{$_.Item1.Value -eq 'CheckInstallSafety'})[0].Item2.Extent.Text
  $safety=$safety.Substring(1,$safety.Length-2)
  & ([scriptblock]::Create($safety))
  throw 'The actual safety phase did not exit.'
}
if($Case -ne 'Handoff'){
  foreach($name in @('PostInstall','Recover')){
    $phase=@($phases.Clauses|Where-Object{$_.Item1.Value -eq $name})[0].Item2
    $writer=$phase.Find({param($node)$node -is [Management.Automation.Language.PipelineAst] -and ($node.Extent.Text -like 'Write-ValidatedInstallationIdentity*' -or ($node.Extent.Text -like 'Write-Utf8NoBomFile*' -and $node.Extent.Text -like '*installation.json*'))},$true)
    Require ([bool]$writer) 'Actual identity publication statement was not found.'
    . ([scriptblock]::Create($writer.Extent.Text))
    $identity=Get-Content -LiteralPath (Join-Path $installRoot 'resources\installation.json') -Raw|ConvertFrom-Json
    Require ($identity.version -eq '3.8.0') ("$name published literal version "+$identity.version+' instead of validated 3.8.0.')
    $parsed=[Guid]::Empty;Require ([Guid]::TryParse($identity.id,[ref]$parsed)) 'Fresh installation identity is not a UUID.'
    Write-Output "PASS: actual $name identity publication uses matching real PE/runtime version"
  }
  if($Case -eq 'Version'){exit 0}
}
if($Case -ne 'Version'){
  $allowed=Test-InstallMayStopOwnedRuntimes 2>$null
  Require (-not $allowed) 'Existing install without active DoH entered destructive direct installation.'
  Require $script:installSafetyHandoffAllowed 'Verified canonical installation was not eligible for handoff.'
  Write-Output 'PASS: verified existing install without active DoH requires protected handoff'
}
$script:protected=$true
Require (Test-InstallMayStopOwnedRuntimes) 'Authenticated protected worker was blocked.'
Require (-not $script:installSafetyHandoffAllowed) 'Protected worker requested recursive dispatch.'
$script:protected=$false
Write-Output 'PASS: authenticated silent worker keeps direct installation without recursive handoff'
$identityPath=Join-Path $installRoot 'resources\installation.json';$identityHash=Get-FileSha256 $identityPath
Write-CandidatePE -Product 'Foreign Application'
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'Foreign PE was eligible for handoff.'
Refused {Write-ValidatedInstallationIdentity $installRoot}
Require ((Get-FileSha256 $identityPath) -eq $identityHash) 'Foreign PE refusal changed identity.'
Write-CandidatePE
Write-Output 'PASS: foreign real PE product fails closed before handoff or identity writes'
Write-CandidatePE -Version '3.7.9'
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'Mismatching real PE version was eligible for handoff.'
Refused {Write-ValidatedInstallationIdentity $installRoot};Write-CandidatePE
Require ((Get-FileSha256 $identityPath) -eq $identityHash) 'Mismatching version changed identity.'
Write-Output 'PASS: PE/runtime version disagreement preserves installation identity and rejects handoff'
$manifest.packageVersion='';Save-Manifest
Refused {Write-ValidatedInstallationIdentity $installRoot}
$manifest.packageVersion='3.8.0';Save-Manifest
Write-Output 'PASS: missing manifest version fails before identity publication'
$asset=Join-Path $installRoot 'resources\runtime\xray\fixture.bin'
[IO.File]::WriteAllText($asset,'tampered')
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'Failed actual checksum inventory approved handoff.'
[IO.File]::WriteAllText($asset,'fixture-xray')
Write-Output 'PASS: corrupt runtime inventory cannot approve preservation handoff'
$saved=$installRoot;$installRoot=Join-Path $fixture 'outside'
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'Noncanonical target approved direct install or handoff.'
Write-Output 'PASS: noncanonical target fails before direct installation or handoff'
$script:canonicalRoot=$installRoot
Require (Test-InstallMayStopOwnedRuntimes) 'First installation was blocked.'
$null=New-Item -ItemType Directory -Path $installRoot
Require (Test-InstallMayStopOwnedRuntimes) 'Empty canonical first-install directory was blocked.'
Write-Output 'PASS: absent and empty canonical targets retain the first-install path'
[IO.File]::WriteAllText((Join-Path $installRoot 'foreign.txt'),'foreign')
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'Unidentified nonempty target approved handoff.'
Write-Output 'PASS: unidentified nonempty target is refused without dispatch'
Remove-Item -LiteralPath (Join-Path $installRoot 'foreign.txt')
$script:dnsFailure=$true
Require (-not (Test-InstallMayStopOwnedRuntimes 2>$null) -and -not $script:installSafetyHandoffAllowed) 'DNS preflight failure approved handoff.'
$script:dnsFailure=$false
Write-Output 'PASS: DNS preflight failure remains an unsafe refusal'
$script:canonicalRoot=$saved;$installRoot=$saved
$link=Join-Path $fixture 'linked';$junctionTarget=Join-Path $env:LAGOM_TEST_TEMP ('vj-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$null=New-Item -ItemType Directory -Path $junctionTarget
$null=New-Item -ItemType Junction -Path $link -Target $junctionTarget
$script:canonicalRoot=$link;$installRoot=$link
Require (-not (Test-CanonicalInstallerTarget $installRoot)) 'Real reparse target was accepted.'
Write-Output 'PASS: real reparse install target is rejected'
Write-Output 'Version and handoff checks: 13 passed; actual isolated PE/files, no service/network/registry mutations'
