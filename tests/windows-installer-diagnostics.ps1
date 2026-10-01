[CmdletBinding()]
param([switch]$LibraryOnly)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'

if($LibraryOnly){return}
# Use the real hosted guard entry point before any directory or machine write.
& (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -Mode GuardOnly
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
$script:InstallRoot=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield'
$script:DataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShield'
$script:InstallerDataRoot=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'EgoistShieldInstaller'
Assert-NativeCleanStart
$script:Work=Join-Path $env:RUNNER_TEMP 'lagom-installer-diagnostics'
if(Test-Path -LiteralPath $script:Work){throw 'Diagnostic work already exists; inspect before retry.'}
[void][IO.Directory]::CreateDirectory($script:Work)
$script:NativePowerShell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$helper=Join-Path $project 'src\installer\owned-cleanup.ps1'
Assert-NativeOrdinaryPath -Path $helper -Leaf
$receipt=[ordered]@{kind='real-source-phase-installer-diagnostic';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;os=[Environment]::OSVersion.VersionString;parentPowerShell=$PSVersionTable.PSVersion.ToString();cleanStart=$true;installerExecuted=$false;preInstallExecuted=$false;sourceHashes=@();beforeNetwork=(Get-NativeNetworkFingerprint);beforeServices=(Get-NativeProductServices);beforeTasks=(Get-NativeProductTasks);result='running'}
foreach($name in @('owned-cleanup.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')){$path=Join-Path $project ('src\installer\'+$name);$receipt.sourceHashes+=[ordered]@{path=('src/installer/'+$name);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}}
$receiptPath=Join-Path $script:Work 'installer-diagnostic.json'
$receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$failure=$null
try{
  $safety=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Phase','CheckInstallSafety','-InstallRoot',$script:InstallRoot) -Label 'source-check-install-safety' -TimeoutSeconds 120
  $receipt.safety=$safety
  # Execute the exact source PreInstall phase on this clean disposable host,
  # retaining stdout/stderr that NSIS normally consumes internally. It is a
  # diagnostic reproduction, never a substitute for generated Setup acceptance.
  $receipt.preInstallExecuted=$true
  $phase=Invoke-NativeBounded -Executable $script:NativePowerShell -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Phase','PreInstall','-InstallRoot',$script:InstallRoot) -Label 'source-pre-install' -TimeoutSeconds 240
  $receipt.preInstall=$phase;$receipt.result='source-phase-passed'
}catch{$failure=$_;$receipt.result='failed';$receipt.error=$_.Exception.Message}
finally{
  $receipt.afterNetwork=Get-NativeNetworkFingerprint;$receipt.afterServices=Get-NativeProductServices;$receipt.afterTasks=Get-NativeProductTasks
  $receipt.networkPreserved=(($receipt.beforeNetwork|ConvertTo-Json -Depth 12 -Compress) -ceq ($receipt.afterNetwork|ConvertTo-Json -Depth 12 -Compress))
  $journal=Join-Path $script:DataRoot 'installer\upgrade-journal.json'
  if(Test-Path -LiteralPath $journal -PathType Leaf){Assert-NativeOrdinaryPath -Path $journal -Leaf;if((Get-Item -LiteralPath $journal).Length -le 1048576){Copy-Item -LiteralPath $journal -Destination (Join-Path $script:Work 'upgrade-journal.json')}}
  $receipt.finishedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
  $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  foreach($name in @('source-check-install-safety.stderr.txt','source-pre-install.stdout.txt','source-pre-install.stderr.txt')){$path=Join-Path $script:Work $name;if(Test-Path -LiteralPath $path){Get-Content -LiteralPath $path -Tail 30}}
}
if($failure){throw $failure}
if(-not $receipt.networkPreserved){throw 'Diagnostic PreInstall changed the unrelated runner network.'}
Write-Output 'Exact source installer phases passed; generated Setup acceptance is still required.'
