[CmdletBinding()]
param([switch]$LibraryOnly,[string]$SignedCandidateAssetsDirectory='',[switch]$CoreConfigurationOnly,[string]$OriginalAssetsDirectory='',[ValidateSet('','3.7.8','3.7.9')][string]$OriginalVersion='',[switch]$GuiFailureDiagnostic,[switch]$RestoreAuthenticatedBaseline,[switch]$OrdinaryGuiDiagnostic)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'


function Assert-OrdinaryGuiDiagnosticSelection {
  param([hashtable]$Selection)
  if([string]$Selection.ORDINARY_GUI_DIAGNOSTIC -ceq 'false'){return}
  if([string]$Selection.ORDINARY_GUI_DIAGNOSTIC -cne 'true'){throw 'Invalid ordinary GUI diagnostic selection.'}
  if([string]$Selection.INSTALLER_DIAGNOSTICS -cne 'true' -or [string]$Selection.DIAGNOSTIC_RELEASE_ID -cnotmatch '^[1-9][0-9]{0,18}$' -or [string]$Selection.DIAGNOSTIC_VARIANT -cne 'candidate'){throw 'Ordinary GUI diagnostics require the exact authenticated current candidate.'}
  foreach($name in @('DIAGNOSTIC_ALL_VERSIONS','DIAGNOSTIC_LEGACY_ONLY','CORE_CONFIGURATION_DIAGNOSTIC','DIAGNOSTIC_LEGACY_RESTORE','PACKAGE_CANDIDATE','NATIVE_ACCEPTANCE','SIGNED_CURRENT_ONLY')){
    if([string]$Selection[$name] -cne 'false'){throw ('Ordinary GUI diagnostics refuse the conflicting selection: '+$name)}
  }
  if([string]$Selection.SIGNED_LEGACY_RELEASE_ID -cne ''){throw 'Ordinary GUI diagnostics refuse a legacy acceptance release.'}
}
function Get-OrdinaryGuiDiagnosticAllowedPaths {
  return @('.github/workflows/ci.yml','tests/windows-installer-diagnostics.ps1','tests/windows-ordinary-gui.cs','tests/windows-ordinary-gui.ps1','tests/ordinary-gui-diagnostic-contract.test.mjs','tests/ordinary-gui-diagnostics.test.mjs')
}
function Get-OrdinaryGuiDiagnosticSourceProof {
  param([string]$Project,$Manifest,[string]$HostedCommit)
  $artifact=[string]$Manifest.source.commit;$artifactTree=[string]$Manifest.source.tree
  if($HostedCommit -cnotmatch '^[a-f0-9]{40}$' -or $artifact -cnotmatch '^[a-f0-9]{40}$' -or $artifactTree -cnotmatch '^[a-f0-9]{40}$'){throw 'Diagnostic source identities must be exact commit/tree SHA values.'}
  if([string]$Manifest.product -cne 'Egoist Lagom' -or [string]$Manifest.version -cne '3.8.0'){throw 'Ordinary GUI diagnostics accept only the current signed 3.8.0 artifact.'}
  $head=(& git -C $Project rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $head -cne $HostedCommit){throw 'Diagnostic harness checkout differs from the actual workflow SHA.'}
  $dirty=@(& git -C $Project status --porcelain --untracked-files=no)
  if($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0){throw 'Diagnostic harness tracked sources must be clean.'}
  & git -C $Project cat-file -e ($artifact+'^{commit}') 2>$null
  if($LASTEXITCODE -ne 0){
    $origin=(& git -C $Project remote get-url origin).Trim()
    if($LASTEXITCODE -ne 0 -or $origin -cnotmatch '^https://github[.]com/egoist-ai1/egoist-lagom(?:[.]git)?$'){throw 'Diagnostic source fetch requires the exact official repository.'}
    $git=Resolve-NativeApplication 'git'
    [void](Invoke-NativeBounded -Executable $git -Arguments @('-C',$Project,'fetch','--no-tags','--depth=1','origin',$artifact) -Label 'diagnostic-source-fetch' -TimeoutSeconds 60)
  }
  $resolved=(& git -C $Project rev-parse ($artifact+'^{commit}')).Trim()
  if($LASTEXITCODE -ne 0 -or $resolved -cne $artifact){throw 'Fetched diagnostic artifact commit differs.'}
  $observedTree=(& git -C $Project rev-parse ($artifact+'^{tree}')).Trim()
  if($LASTEXITCODE -ne 0 -or $observedTree -cne $artifactTree){throw 'Diagnostic artifact tree differs from authenticated integrity.'}
  $harnessTree=(& git -C $Project rev-parse ($HostedCommit+'^{tree}')).Trim()
  if($LASTEXITCODE -ne 0 -or $harnessTree -cnotmatch '^[a-f0-9]{40}$'){throw 'Diagnostic harness tree is unavailable.'}
  $changed=@(& git -C $Project diff --name-only --no-renames --no-ext-diff $artifact $HostedCommit --)
  if($LASTEXITCODE -ne 0){throw 'Diagnostic source diff is unavailable.'}
  $allowed=@(Get-OrdinaryGuiDiagnosticAllowedPaths)
  foreach($name in $changed){if([string]$name -cnotin $allowed){throw ('Unreviewed production/toolchain/trust/diagnostic source difference: '+$name)}}
  $after=(& git -C $Project rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $after -cne $HostedCommit){throw 'Diagnostic harness source changed during verification.'}
  return [ordered]@{artifactSourceCommit=$artifact;artifactSourceTree=$artifactTree;harnessSourceCommit=$HostedCommit;harnessSourceTree=$harnessTree;changedPaths=@($changed);reviewedAllowedPaths=$allowed}
}
function Get-OrdinaryGuiDiagnosticFileReceipt {
  param([string]$Path,[string]$Name)
  Assert-NativeOrdinaryPath -Path $Path -Leaf
  return [ordered]@{file=$Name;bytes=(Get-Item -LiteralPath $Path).Length;sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
}
function Get-OrdinaryGuiDiagnosticBuildEvidence {
  param([string]$WorkRoot)
  $records=@()
  foreach($directory in @(Get-ChildItem -LiteralPath $WorkRoot -Directory | Where-Object {$_.Name -cmatch '^ordinary-gui-[a-f0-9]{12}$'})){
    Assert-NativeOrdinaryPath -Path $directory.FullName
    $files=@()
    foreach($relative in @('source-hashes.json','build.txt','run.stdout.txt','run.stderr.txt','bin/Release/net10.0-windows/OrdinaryGuiHarness.exe','bin/Release/net10.0-windows/OrdinaryGuiHarness.dll')){
      $file=Join-Path $directory.FullName $relative
      if(Test-Path -LiteralPath $file -PathType Leaf){$files+=Get-OrdinaryGuiDiagnosticFileReceipt -Path $file -Name $relative}
    }
    $sourcePath=Join-Path $directory.FullName 'source-hashes.json'
    $sources=if(Test-Path -LiteralPath $sourcePath -PathType Leaf){@(Get-Content -LiteralPath $sourcePath -Raw | ConvertFrom-Json)}else{@()}
    $records+=[ordered]@{directory=$directory.Name;files=$files;transitiveSourceHashes=$sources}
  }
  return $records
}

function New-OrdinaryGuiDiagnosticIntegrityCopy {
  param([string]$ManifestPath,[string]$Workspace,[string]$ExpectedSha256,[string]$RunId,[string]$RunAttempt)
  if($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$' -or $RunId -cnotmatch '^[1-9][0-9]*$' -or $RunAttempt -cnotmatch '^[1-9][0-9]*$'){throw 'Invalid signed diagnostic staging identity.'}
  Assert-NativeOrdinaryPath -Path $ManifestPath -Leaf
  Assert-NativeOrdinaryPath -Path $Workspace
  $before=Get-OrdinaryGuiDiagnosticFileReceipt -Path $ManifestPath -Name 'original/package-integrity.json'
  if($before.sha256.ToLowerInvariant() -cne $ExpectedSha256 -or $before.bytes -gt 16777216){throw 'Diagnostic original integrity differs from signed bytes.'}
  $parent=Join-Path $Workspace 'dist'
  if(Test-Path -LiteralPath $parent){Assert-NativeOrdinaryPath -Path $parent}else{[void][IO.Directory]::CreateDirectory($parent);Assert-NativeOrdinaryPath -Path $parent}
  $directory=Assert-NativePathWithin -Path (Join-Path $parent ('ordinary-diag-'+$RunId+'-'+$RunAttempt)) -Root $Workspace
  if(Test-Path -LiteralPath $directory){throw 'Diagnostic integrity staging must be fresh.'}
  [void][IO.Directory]::CreateDirectory($directory);Assert-NativeOrdinaryPath -Path $directory
  $copy=Join-Path $directory 'package-integrity.json'
  $input=[IO.File]::Open($ManifestPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $output=$null
  try{$output=[IO.File]::Open($copy,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$input.CopyTo($output);$output.Flush($true)}
  finally{if($output){$output.Dispose()};$input.Dispose()}
  $copied=Get-OrdinaryGuiDiagnosticFileReceipt -Path $copy -Name 'staged/package-integrity.json'
  $after=Get-OrdinaryGuiDiagnosticFileReceipt -Path $ManifestPath -Name 'original/package-integrity.json'
  if($after.sha256 -cne $before.sha256 -or $after.bytes -ne $before.bytes -or $copied.sha256 -cne $before.sha256 -or $copied.bytes -ne $before.bytes){throw 'Diagnostic integrity changed or its byte copy differs.'}
  return [ordered]@{path=$copy;original=$after;copy=$copied;signedSha256=$ExpectedSha256}
}

function Invoke-OrdinaryGuiDiagnosticAttempt {
  param($Receipt,[ValidateSet('original','instrumented')][string]$Label,[bool]$CaptureStandardStreams)
  . (Join-Path $PSScriptRoot 'windows-ordinary-gui.ps1') -OrdinaryGuiLibraryOnly
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
  $evidence=Join-Path $script:Work ('ordinary-'+$Label)
  [void][IO.Directory]::CreateDirectory($evidence)
  $attempt=[ordered]@{kind='actual-ordinary-gui-launch-diagnostic';releaseReady=$false;result='running';label=$Label;captureStandardStreams=$CaptureStandardStreams;artifactSourceCommit=$script:SourceCommit;harnessSourceCommit=$env:GITHUB_SHA;launch=$null;normalClose=$false;exitCode=$null;cleanup=$null;buildEvidence=@()}
  $beforeBuilds=@(Get-ChildItem -LiteralPath $script:Work -Directory | Select-Object -ExpandProperty Name)
  $lease=$null;$child=$null;$failure=$null
  try{
    $lease=Start-OrdinaryGuiLease -CanonicalInstalledGuiPath (Join-Path $script:InstallRoot 'EgoistShield.exe') -IntegrityManifestPath $Receipt.stagedIntegrity.path -ExpectedSourceCommit $script:SourceCommit -ExpectedHarnessSourceCommit $env:GITHUB_SHA -CaptureStandardStreams $CaptureStandardStreams -WorkRoot $script:Work -EvidenceDirectory $evidence
    $proof=$lease.Receipt;$attempt.launch=$proof
    if(([string]$proof.source.integrityManifestSha256).ToLowerInvariant() -cne $Receipt.stagedIntegrity.signedSha256 -or $proof.source.version -cne $script:Version){throw 'Ordinary GUI consumed integrity bytes/version different from the signed artifact.'}
    if($proof.source.commit -cne $script:SourceCommit -or $proof.artifactSourceCommit -cne $script:SourceCommit -or $proof.harnessSourceCommit -cne $env:GITHUB_SHA -or @($proof.arguments).Count -ne 0){throw 'Ordinary GUI diagnostic launch/source proof differs.'}
    $child=[Diagnostics.Process]::GetProcessById([int]$proof.processId)
    if($child.HasExited -or $child.MainModule.FileName -ine (Join-Path $script:InstallRoot 'EgoistShield.exe') -or [Math]::Abs(($child.StartTime.ToUniversalTime()-[DateTimeOffset]::Parse($proof.startTimeUtc).UtcDateTime).TotalMilliseconds) -gt 20){throw 'Ordinary GUI diagnostic child identity changed before close.'}
    $window=[Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$proof.mainWindowHandle))
    if(-not $window -or $window.Current.ProcessId -ne $child.Id){throw 'Diagnostic UIA window does not belong to the held ordinary GUI.'}
    $pattern=$null
    if(-not $window.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){throw 'Diagnostic ordinary GUI lacks a native close pattern.'}
    ([Windows.Automation.WindowPattern]$pattern).Close()
    if(-not $child.WaitForExit(30000)){throw 'Diagnostic ordinary GUI did not close within its held-process budget.'}
    $attempt.exitCode=$child.ExitCode
    if($child.ExitCode -ne 0){throw 'Diagnostic ordinary GUI exited with a nonzero code after native close.'}
    $attempt.normalClose=$true;$attempt.result='ordinary-launch-and-normal-close-diagnostic-only'
  }catch{$failure=$_;$attempt.result='failed';$attempt.error=$_.Exception.Message}
  finally{
    if($lease){
      try{$attempt.cleanup=Stop-OrdinaryGuiLease -Lease $lease;if(-not $attempt.normalClose -or -not $attempt.cleanup.exitedNormally -or $attempt.cleanup.exitCode -ne 0){throw 'Diagnostic ordinary GUI lacks normal exit and zero-orphan cleanup.'}}
      catch{if(-not $failure){$failure=$_;$attempt.result='failed';$attempt.error=$_.Exception.Message}}
    }
    if($child){$child.Dispose()}
    try{
      $attempt.buildEvidence=@(Get-OrdinaryGuiDiagnosticBuildEvidence -WorkRoot $script:Work | Where-Object {$_.directory -cnotin $beforeBuilds})
      $attempt.integrityCopyAfter=Get-OrdinaryGuiDiagnosticFileReceipt -Path $Receipt.stagedIntegrity.path -Name 'staged/package-integrity.json'
      if($attempt.integrityCopyAfter.sha256.ToLowerInvariant() -cne $Receipt.stagedIntegrity.signedSha256){throw 'Diagnostic integrity copy changed during ordinary launch.'}
    }catch{if(-not $failure){$failure=$_;$attempt.result='failed';$attempt.error=$_.Exception.Message}else{$attempt.evidenceError=$_.Exception.Message}}
  }
  if(-not $failure){try{Assert-NativeNoGui}catch{$attempt.result='failed';$attempt.error=$_.Exception.Message}}
  return $attempt
}

function Invoke-OrdinaryGuiLaunchDiagnostic {
  param($Receipt)
  $Receipt.ordinaryGui=[ordered]@{kind='actual-ordinary-gui-launch-diagnostic';releaseReady=$false;artifactSourceCommit=$script:SourceCommit;harnessSourceCommit=$env:GITHUB_SHA;result='running';attempts=@()}
  $signedMetadata=Get-Content -LiteralPath (Join-Path $SignedCandidateAssetsDirectory 'release-manifest.json') -Raw | ConvertFrom-Json
  $Receipt.stagedIntegrity=New-OrdinaryGuiDiagnosticIntegrityCopy -ManifestPath $script:ManifestPath -Workspace $env:GITHUB_WORKSPACE -ExpectedSha256 $signedMetadata.integrityManifestSha256 -RunId $env:GITHUB_RUN_ID -RunAttempt $env:GITHUB_RUN_ATTEMPT
  $original=Invoke-OrdinaryGuiDiagnosticAttempt -Receipt $Receipt -Label 'original' -CaptureStandardStreams $false
  $Receipt.ordinaryGui.attempts+=,$original
  if($original.result -ceq 'ordinary-launch-and-normal-close-diagnostic-only'){
    $Receipt.ordinaryGui.result='original-ordinary-launch-and-normal-close-diagnostic-only'
    $Receipt.ordinaryGui.cause='Previous early exit not reproduced by this bounded original-style observation.'
    return
  }
  $instrumented=Invoke-OrdinaryGuiDiagnosticAttempt -Receipt $Receipt -Label 'instrumented' -CaptureStandardStreams $true
  $Receipt.ordinaryGui.attempts+=,$instrumented
  $Receipt.ordinaryGui.result='original-launch-failed-with-instrumented-followup'
  $Receipt.ordinaryGui.error=$original.error
  throw ('Original-style ordinary GUI launch failed; separately instrumented follow-up retained: '+$original.error)
}

if($LibraryOnly){return}
$diagnosticRestore=[bool]$RestoreAuthenticatedBaseline
if($diagnosticRestore -and (-not $OriginalVersion -or -not $GuiFailureDiagnostic)){throw 'Restored diagnostics require an explicit original version and GUI failure diagnostic.'}
if($CoreConfigurationOnly -and $SignedCandidateAssetsDirectory){throw 'Choose either signed Setup or source Core diagnostics.'}
# Use the real hosted guard entry point before any directory or machine write.
& (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -Mode GuardOnly
. (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
if($OrdinaryGuiDiagnostic){
  if(-not $SignedCandidateAssetsDirectory -or $CoreConfigurationOnly -or $OriginalAssetsDirectory -or $OriginalVersion -or $GuiFailureDiagnostic -or $RestoreAuthenticatedBaseline){throw 'Ordinary GUI diagnostics require current authenticated candidate assets only.'}
  $selection=@{}
  foreach($name in @('ORDINARY_GUI_DIAGNOSTIC','INSTALLER_DIAGNOSTICS','DIAGNOSTIC_RELEASE_ID','DIAGNOSTIC_VARIANT','DIAGNOSTIC_ALL_VERSIONS','DIAGNOSTIC_LEGACY_ONLY','CORE_CONFIGURATION_DIAGNOSTIC','DIAGNOSTIC_LEGACY_RESTORE','PACKAGE_CANDIDATE','NATIVE_ACCEPTANCE','SIGNED_LEGACY_RELEASE_ID','SIGNED_CURRENT_ONLY')){$selection[$name]=[Environment]::GetEnvironmentVariable($name)}
  Assert-OrdinaryGuiDiagnosticSelection -Selection $selection
}
if(($OriginalAssetsDirectory -or $OriginalVersion -or $GuiFailureDiagnostic) -and -not $SignedCandidateAssetsDirectory){throw 'Additional failure diagnostics require an authenticated signed candidate.'}
if([bool]$OriginalAssetsDirectory -ne [bool]$OriginalVersion){throw 'Original diagnostic assets and version must be selected together.'}
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
$receipt=[ordered]@{kind='real-source-phase-installer-diagnostic';sourceCommit=$env:GITHUB_SHA;runId=$env:GITHUB_RUN_ID;os=[Environment]::OSVersion.VersionString;imageOS=$env:ImageOS;imageVersion=$env:ImageVersion;parentPowerShell=$PSVersionTable.PSVersion.ToString();cleanStart=$true;installerExecuted=$false;preInstallExecuted=$false;sourceHashes=@();mutations=@();gui=@();beforeNetwork=(Get-NativeNetworkFingerprint);beforeServices=(Get-NativeProductServices);beforeTasks=(Get-NativeProductTasks);result='running';releaseReady=$false}
foreach($name in @('owned-cleanup.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')){$path=Join-Path $project ('src\installer\'+$name);$receipt.sourceHashes+=[ordered]@{path=('src/installer/'+$name);sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}}
$receiptPath=Join-Path $script:Work 'installer-diagnostic.json'
if($OrdinaryGuiDiagnostic){$script:Receipt=$receipt;$script:ReceiptPath=$receiptPath;$receipt.checks=@();$receipt.networkReadbacks=@()}
$receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$failure=$null
try{
  if($CoreConfigurationOnly){
    $receipt.kind='real-source-core-configuration-diagnostic'
    $dotnet=Join-Path $env:DOTNET_INSTALL_DIR 'dotnet.exe'
    Assert-NativeOrdinaryPath -Path $dotnet -Leaf
    $sdk=Invoke-NativeBounded -Executable $dotnet -Arguments @('--version') -Label 'core-diagnostic-sdk' -TimeoutSeconds 30
    $pin=(Get-Content -LiteralPath (Join-Path $project 'global.json') -Raw | ConvertFrom-Json).sdk.version
    if((Get-Content -LiteralPath (Join-Path $script:Work 'core-diagnostic-sdk.stdout.txt') -Raw).Trim() -cne $pin){throw 'The actual Core diagnostic SDK differs from the exact project pin.'}
    $build=Join-Path $script:Work 'core-build'
    $publish=Join-Path $script:Work 'core-publish'
    $coreProject=Join-Path $project 'src\service\EgoistShield.Service.csproj'
    $coreObj=(Join-Path $build 'core-obj')+'\'
    $coreProps=@('-p:PublishSingleFile=true','-p:SelfContained=true',('-p:BaseIntermediateOutputPath='+$coreObj),('-p:MSBuildProjectExtensionsPath='+$coreObj),'-p:DefaultItemExcludes=obj\**\*.cs')
    $receipt.restore=Invoke-NativeBounded -Executable $dotnet -Arguments (@('restore',$coreProject,'--locked-mode','-r','win-x64')+$coreProps+@('-v','quiet')) -Label 'core-diagnostic-restore' -TimeoutSeconds 180
    $receipt.build=Invoke-NativeBounded -Executable $dotnet -Arguments (@('publish',$coreProject,'--no-restore','-c','Release','-r','win-x64')+$coreProps+@('-p:EnableCompressionInSingleFile=true','-o',$publish,'-v','quiet')) -Label 'core-diagnostic-publish' -TimeoutSeconds 360
    $core=Join-Path $publish 'EgoistShield.Service.exe'
    Assert-NativeOrdinaryPath -Path $core -Leaf
    $receipt.coreBinary=@{sha256=(Get-FileHash -LiteralPath $core -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath $core).Length;sdk=$pin}
    $receipt.configure=Invoke-NativeBounded -Executable $core -Arguments @('configure','--install-root',$script:InstallRoot) -Label 'core-diagnostic-configure' -TimeoutSeconds 120
    $receipt.configurationAcl=@()
    foreach($entry in @(@{path=$script:DataRoot;private=$false},@{path=(Join-Path $script:DataRoot 'Service');private=$true},@{path=(Join-Path $script:DataRoot 'Service\service-config.json');private=$true},@{path=(Join-Path $script:DataRoot 'Service\acl-hardening.marker');private=$true})){
      $identity=Assert-NativeAdministratorOwned $entry.path
      $acl=Get-Acl -LiteralPath $entry.path
      if($entry.private){
        foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
          if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Private Core configuration allows an untrusted principal.'}
        }
      }
      $receipt.configurationAcl+=$identity
    }
    if((Get-Content -LiteralPath (Join-Path $script:DataRoot 'Service\acl-hardening.marker') -Raw).Trim() -cne '4'){throw 'Core hardening marker did not complete the owner migration.'}
    $pwsh=Resolve-NativeApplication 'pwsh'
    $receipt.ownerRegression=Invoke-NativeBounded -Executable $pwsh -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-File',(Join-Path $PSScriptRoot 'core-owner-regression.ps1'),'-WorkRoot',$script:Work,'-DotnetPath',$dotnet) -Label 'core-diagnostic-owner-regression' -TimeoutSeconds 180
    Assert-NativeNoGui
    if(@(Get-NativeProductServices).Count -ne 0 -or @(Get-NativeProductTasks).Count -ne 0){throw 'Direct Core configure unexpectedly registered a service or Task.'}
    $receipt.result='source-core-configuration-and-acl-passed-diagnostic-only'
  }elseif($SignedCandidateAssetsDirectory){
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
    $script:SourceCommit=$manifest.source.commit;$script:Version=$version;$script:ManifestPath=Join-Path $assets 'package-integrity.json';$script:Node=$node
    $script:Core=Join-Path $script:InstallRoot 'resources\core-service\win-x64\EgoistShield.Service.exe'

    if($OrdinaryGuiDiagnostic){
      $receipt.kind='real-signed-current-ordinary-gui-diagnostic'
      $receipt.sourceProof=Get-OrdinaryGuiDiagnosticSourceProof -Project $project -Manifest $manifest -HostedCommit $env:GITHUB_SHA
      $receipt.harnessSourceCommit=$receipt.sourceProof.harnessSourceCommit;$receipt.harnessSourceTree=$receipt.sourceProof.harnessSourceTree;$receipt.artifactSourceTree=$receipt.sourceProof.artifactSourceTree
      $receipt.authenticatedAssets=@()
      foreach($name in @(('EgoistShield-Setup-'+$version+'.exe'),'package-integrity.json','release-manifest.json','release-manifest.json.sig','release-key-registry.json','release-key-registry.json.sig')){$receipt.authenticatedAssets+=Get-OrdinaryGuiDiagnosticFileReceipt -Path (Join-Path $assets $name) -Name $name}
      $receipt.harnessFileHashes=@()
      foreach($name in @(Get-OrdinaryGuiDiagnosticAllowedPaths)){$receipt.harnessFileHashes+=Get-OrdinaryGuiDiagnosticFileReceipt -Path (Join-Path $project $name) -Name $name}
      $dotnet=Join-Path $env:DOTNET_INSTALL_DIR 'dotnet.exe'
      $sdk=Invoke-NativeBounded -Executable $dotnet -Arguments @('--version') -Label 'ordinary-diagnostic-sdk' -TimeoutSeconds 30
      $pin=(Get-Content -LiteralPath (Join-Path $project 'global.json') -Raw | ConvertFrom-Json).sdk.version
      if((Get-Content -LiteralPath (Join-Path $script:Work 'ordinary-diagnostic-sdk.stdout.txt') -Raw).Trim() -cne $pin){throw 'Ordinary diagnostic SDK differs from the project pin.'}
      $receipt.harnessSdk=[ordered]@{version=$pin;readback=$sdk}
    }
    if($OriginalVersion){
      $original=Assert-NativePathWithin $OriginalAssetsDirectory $env:RUNNER_TEMP
      Assert-NativeOrdinaryPath $original
      $authWork=Join-Path $env:RUNNER_TEMP ("lagom-legacy-native-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT")
      if(Test-Path -LiteralPath $authWork){throw 'Original diagnostic authentication work must be fresh.'}
      [void][IO.Directory]::CreateDirectory($authWork)
      $optionsPath=Join-Path $authWork 'original-authentication.options.json'
      $authOutput=Join-Path $authWork 'original-authentication.json'
      [IO.File]::WriteAllText($optionsPath,([ordered]@{oldVersion=$OriginalVersion;oldAssets=$original;candidateAssets=$assets;integrityPath=$script:ManifestPath;sourceCommit=$manifest.source.commit;output=$authOutput}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
      [void](Invoke-NativeBounded -Executable $node -Arguments @((Join-Path $PSScriptRoot 'windows-production-legacy-upgrade.mjs'),'verify-assets',$optionsPath) -Label 'original-diagnostic-authentication' -TimeoutSeconds 120)
      $receipt.originalAuthenticated=Get-Content -LiteralPath $authOutput -Raw | ConvertFrom-Json
      Copy-Item -LiteralPath $authOutput -Destination $script:Work
      $installer=Join-Path $original ('EgoistShield-Setup-'+$OriginalVersion+'.exe')
      $version=$OriginalVersion;$receipt.kind='real-original-signed-setup-gui-failure-diagnostic'
      $receipt.originalVersion=$OriginalVersion
      . (Join-Path $PSScriptRoot 'windows-production-legacy-upgrade.ps1') -ExpectedOldVersion $OriginalVersion -LibraryOnly
      [void](Read-LegacyNetworkCompatibility -ProbeOnly:$diagnosticRestore)
    }
    Assert-NativeOrdinaryPath -Path $installer -Leaf
    $receipt.installer=@{version=$version;sha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath $installer).Length}
    if($diagnosticRestore){
      $script:Evidence=Join-Path $script:Work 'restored-native-evidence';[void][IO.Directory]::CreateDirectory($script:Evidence)
      . (Join-Path $PSScriptRoot 'windows-native-legacy-baseline.ps1') -LibraryOnly
      $auth=$receipt.originalAuthenticated.old
      $receipt.restoredLegacyBaseline=Invoke-RestoredLegacyBaseline -OriginalVersion $OriginalVersion -AuthenticatedInstaller $installer -ExpectedInstallerSha256 $auth.sha256 -ExpectedInstallerSha512 $auth.sha512 -ExpectedInstallerBytes $auth.size -InstallationRoot $script:InstallRoot -WorkDirectory $script:Work -EvidenceDirectory $script:Evidence -NodePath $node -PowerShellPath $script:NativePowerShell
      $receipt.kind='restored-authenticated-original-launch-diagnostic';$receipt.originalSetupExecuted=$false;$receipt.result='restored-original-baseline-diagnostic-only'
    }else{
      $receipt.installerExecuted=$true
      $phase=Invoke-NativeBounded -Executable $installer -Arguments @('/S') -Label 'signed-diagnostic-clean-install' -TimeoutSeconds 600
      $receipt.install=$phase;$receipt.result='signed-setup-installed-diagnostic-only'
    }
    $receipt.installedAcl=@(foreach($relative in @('','EgoistShield.exe','EgoistShield.Worker.exe','resources','resources\app.asar','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\core-service\win-x64\EgoistShield.Service.exe')){$path=Join-Path $script:InstallRoot $relative;if(Test-Path -LiteralPath $path){Get-NativePathAclSnapshot $path}})

    if($OrdinaryGuiDiagnostic){
      $receipt.installedAcl=@(foreach($relative in @('','EgoistShield.exe','EgoistShield.Worker.exe','resources','resources\app.asar','resources\component-worker.cjs','resources\worker-host-integrity.json','resources\core-service\win-x64\EgoistShield.Service.exe')){Assert-NativeAdministratorOwned (Join-Path $script:InstallRoot $relative) -InstallationPath})
      $verifyWork=Join-Path $env:RUNNER_TEMP ("lagom-legacy-native-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT")
      if(Test-Path -LiteralPath $verifyWork){throw 'Ordinary diagnostic payload work must be fresh.'}
      [void][IO.Directory]::CreateDirectory($verifyWork)
      $verifyOutput=Join-Path $verifyWork 'installed-payload.json'
      $optionsPath=Join-Path $verifyWork 'installed-payload.options.json'
      $options=[ordered]@{installedRoot=$script:InstallRoot;integrityPath=$script:ManifestPath;sourceCommit=$script:SourceCommit;integritySha256=(Get-FileHash -LiteralPath $script:ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant();installerSha256=$receipt.installer.sha256.ToLowerInvariant();output=$verifyOutput}
      [IO.File]::WriteAllText($optionsPath,($options|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
      [void](Invoke-NativeBounded -Executable $node -Arguments @((Join-Path $PSScriptRoot 'windows-production-legacy-upgrade.mjs'),'verify-payload',$optionsPath) -Label 'ordinary-diagnostic-installed-payload' -TimeoutSeconds 180)
      Copy-Item -LiteralPath $verifyOutput -Destination (Join-Path $script:Work 'installed-payload.json')
      $receipt.installedPayload=Get-OrdinaryGuiDiagnosticFileReceipt -Path (Join-Path $script:Work 'installed-payload.json') -Name 'installed-payload.json'
      $receipt.elevation=Assert-NativeGuiElevation
      $receipt.core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $script:Core -Running
      $receipt.corePolicy=Get-NativeRecoveryPolicy 'EgoistShieldCore'
      Assert-NativeNoGui;Assert-NativeNetworkPreserved 'ordinary-diagnostic-clean-install'
      $gui=Invoke-NativeGui -Action 'provision-telegram' -Label 'gui-provision';Assert-NativeNoGui
      $port=[int]$gui.installResult.portConflict.port
      $receipt.telegramWithoutGui=Assert-NativeTelegramEndpoint -Port $port
      $receipt.telegramPolicy=Get-NativeRecoveryPolicy 'EgoistShieldTelegramProxy'
      Assert-NativeNetworkPreserved 'ordinary-diagnostic-privileged-gui-close'
      $receipt.precedingSequence='actual-authenticated-setup-payload-acl-core-privileged-gui-telegram-provision-normal-close-before-ordinary-launch'
      $receipt.mutations+=@{kind='actual-ordinary-gui-launch-and-native-close';target='canonical installed GUI';scope='own held child/job only'}
      Invoke-OrdinaryGuiLaunchDiagnostic -Receipt $receipt
      $receipt.result='signed-current-ordinary-gui-diagnostic-only'
    }
    if($GuiFailureDiagnostic){
      if($OriginalVersion){
        . (Join-Path $PSScriptRoot 'windows-production-legacy-upgrade.ps1') -ExpectedOldVersion $OriginalVersion -LibraryOnly
        if($diagnosticRestore){
          . (Join-Path $PSScriptRoot 'windows-legacy-launch-diagnostic.ps1') -LibraryOnly
          $expectedGui=@($receipt.restoredLegacyBaseline.authenticatedExtraction.payload|Where-Object path -ceq 'EgoistShield.exe')
          if($expectedGui.Count -ne 1){throw 'Original GUI authentication inventory is incomplete.'}
          $launchReceipt=Invoke-LegacyLaunchDiagnostic -InstalledGuiPath (Join-Path $script:InstallRoot 'EgoistShield.exe') -ExpectedGuiSha256 $expectedGui[0].sha256 -ExpectedOldVersion $OriginalVersion -WorkRoot $script:Work -EvidenceDirectory $script:Evidence -ExpectedSourceCommit $env:GITHUB_SHA
          $launchData=Read-LegacyHarnessJson -Path $launchReceipt -MaximumBytes 1048576
          $receipt.originalLaunchDiagnostic=[ordered]@{file=$launchReceipt;sha256=(Get-FileHash -LiteralPath $launchReceipt -Algorithm SHA256).Hash.ToLowerInvariant();data=$launchData}
        }
        [void](Invoke-LegacyGui)
      }else{[void](Invoke-NativeGui -Action 'provision-telegram' -Label 'diagnostic-gui')}
      $receipt.result='signed-setup-gui-diagnostic-only'
    }
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
