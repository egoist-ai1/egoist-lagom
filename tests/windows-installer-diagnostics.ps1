[CmdletBinding()]
param([switch]$LibraryOnly,[string]$SignedCandidateAssetsDirectory='')
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'

if($LibraryOnly){return}
# Use the real hosted guard entry point before any directory or machine write.
& (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -Mode GuardOnly
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkout=(& git -C $project rev-parse HEAD).Trim()
if($LASTEXITCODE -ne 0 -or $checkout -cne $env:GITHUB_SHA){throw 'Diagnostic harness checkout differs from the actual workflow SHA.'}
$script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield'
$script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
$script:InstallerDataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShieldInstaller'
Assert-NativeCleanStart
$script:Work=Join-Path $env:RUNNER_TEMP 'lagom-installer-diagnostics'
if(Test-Path -LiteralPath $script:Work){throw 'Diagnostic work already exists; inspect before retry.'}
[void][IO.Directory]::CreateDirectory($script:Work)
$script:NativePowerShell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
$helper=Join-Path $project 'src\installer\owned-cleanup.ps1'
Assert-NativeOrdinaryPath -Path $helper -Leaf
$receipt=[ordered]@{kind='real-source-phase-installer-diagnostic';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;os=[Environment]::OSVersion.VersionString;parentPowerShell=$PSVersionTable.PSVersion.ToString();cleanStart=$true;installerExecuted=$false;preInstallExecuted=$false;sourceHashes=@();beforeNetwork=(Get-NativeNetworkFingerprint);beforeServices=(Get-NativeProductServices);beforeTasks=(Get-NativeProductTasks);result='running';releaseReady=$false}
foreach($name in @('owned-cleanup.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')){$path=Join-Path $project ('src\installer\'+$name);$receipt.sourceHashes+=[ordered]@{path=('src/installer/'+$name);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}}
$receiptPath=Join-Path $script:Work 'installer-diagnostic.json'
$receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$failure=$null
try{
  if($SignedCandidateAssetsDirectory){
    $assets=Assert-NativePathWithin $SignedCandidateAssetsDirectory $env:RUNNER_TEMP
    Assert-NativeOrdinaryPath -Path $assets
    $manifest=Get-Content -LiteralPath (Join-Path $assets 'package-integrity.json') -Raw | ConvertFrom-Json
    if($manifest.source.commit -cnotmatch '^[a-f0-9]{40}$'){throw 'Signed diagnostic candidate requires an exact separate artifact source commit.'}
    $version=(Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
    if($manifest.version -cne $version){throw 'Signed diagnostic candidate version differs from the source verifier contract.'}
    $node=Resolve-NativeApplication 'node'
    [void](Invoke-NativeBounded -Executable $node -Arguments @((Join-Path $project 'scripts\prepare-release-assets.mjs'),'--dist',$assets,'--verify-only','true') -Label 'signed-diagnostic-authentication' -TimeoutSeconds 120)
    $receipt.kind='real-signed-setup-failure-diagnostic';$receipt.artifactSourceCommit=$manifest.source.commit
    $installer=Join-Path $assets ('EgoistShield-Setup-'+$version+'.exe')
    Assert-NativeOrdinaryPath -Path $installer -Leaf
    $receipt.installer=@{version=$version;sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath $installer).Length}
    $receipt.installerExecuted=$true
    $phase=Invoke-NativeBounded -Executable $installer -Arguments @('/S') -Label 'signed-diagnostic-clean-install' -TimeoutSeconds 600
    $receipt.install=$phase;$receipt.result='signed-setup-installed-diagnostic-only'
  }else{
  $safety=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Phase','CheckInstallSafety','-InstallRoot',$script:InstallRoot) -Label 'source-check-install-safety' -TimeoutSeconds 120
  $receipt.safety=$safety
  # Execute the exact source PreInstall phase on this clean disposable host,
  # retaining stdout/stderr that NSIS normally consumes internally. It is a
  # diagnostic reproduction, never a substitute for generated Setup acceptance.
  $receipt.preInstallExecuted=$true
  $phase=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Phase','PreInstall','-InstallRoot',$script:InstallRoot) -Label 'source-pre-install' -TimeoutSeconds 240
  $receipt.preInstall=$phase;$receipt.result='source-phase-passed'
  }
}catch{$failure=$_;$receipt.result='failed';$receipt.error=$_.Exception.Message}
finally{
  $receipt.installerDiagnostics=@(Copy-NativeInstallerDiagnostics)
  try{$receipt.afterNetwork=Get-NativeNetworkFingerprint;$receipt.afterServices=Get-NativeProductServices;$receipt.afterTasks=Get-NativeProductTasks}catch{$receipt.finalReadbackError=$_.Exception.Message}
  if(-not $receipt.Contains('afterNetwork')){$receipt.afterNetwork=$null}
  $receipt.networkPreserved=(($receipt.beforeNetwork|ConvertTo-Json -Depth 12 -Compress) -ceq ($receipt.afterNetwork|ConvertTo-Json -Depth 12 -Compress))
  $receipt.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
  $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  foreach($name in @('source-check-install-safety.stderr.txt','source-pre-install.stdout.txt','source-pre-install.stderr.txt','installer-upgrade-journal.jsonl','core-service.log')){$path=Join-Path $script:Work $name;if(Test-Path -LiteralPath $path){Get-Content -LiteralPath $path -Tail 30}}
}
if($failure){throw $failure}
if(-not $receipt.networkPreserved){throw 'Diagnostic PreInstall changed the unrelated runner network.'}
Write-Output 'Diagnostic completed; full signed native acceptance is still required.'
