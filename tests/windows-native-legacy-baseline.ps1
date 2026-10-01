[CmdletBinding()]
param([switch]$LibraryOnly)
Set-StrictMode -Version 2.0
$script:NativeLegacyBaselineNodeHelper=Join-Path $PSScriptRoot 'windows-native-legacy-baseline.mjs'

function Set-RestoredOriginalCompatibility {
  [CmdletBinding()]
  param([ValidateSet('3.7.8','3.7.9')][string]$OriginalVersion,[string]$GuiPath)
  $guardEnvironment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$guardEnvironment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $onWindows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $isAdministrator=$onWindows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-NativeAcceptanceEnvironmentErrors -Environment $guardEnvironment -Administrator $isAdministrator -Windows $onWindows)
  if($errors.Count -ne 0){throw 'Original compatibility restoration host guard refused before registry lookup or mutation.'}
  $canonicalGui=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\EgoistShield.exe'
  if([IO.Path]::GetFullPath($GuiPath) -ine $canonicalGui){throw 'Original compatibility restoration requires the canonical authenticated GUI.'}
  [void](Assert-NativeAdministratorOwned -Path $canonicalGui -InstallationPath)
  $sourceCommit=if($OriginalVersion -ceq '3.7.8'){'5df9a590a83ce86e98575d62807ebfca5939b88e'}else{'d56eb9327fa75a88e91fae62b8d7ea3ed095dcf2'}
  $subKey='Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
  $expected='~ RUNASADMIN'
  $rows=@()
  foreach($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)){
    foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
      $base=$null;$key=$null
      try{
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view);$key=$base.OpenSubKey($subKey,$false)
        $previous=if($null -ne $key){$key.GetValue($canonicalGui,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null}
        if($null -ne $previous -and ($previous -isnot [string] -or $previous -cne $expected)){throw 'Original compatibility restoration found a conflicting pre-existing value; nothing was written.'}
        $rows+=[ordered]@{hive=$hive.ToString();view=$view.ToString();name=$canonicalGui;before=$previous;expected=$expected}
      }finally{if($null -ne $key){$key.Dispose()};if($null -ne $base){$base.Dispose()}}
    }
  }
  foreach($row in $rows){
    $base=$null;$key=$null
    try{
      $hive=[Microsoft.Win32.RegistryHive][Enum]::Parse([Microsoft.Win32.RegistryHive],$row.hive)
      $view=[Microsoft.Win32.RegistryView][Enum]::Parse([Microsoft.Win32.RegistryView],$row.view)
      $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view);$key=$base.CreateSubKey($subKey,$true)
      Add-NativeMutation -Kind 'restore-original-appcompat-value' -Target ($row.hive+' '+$row.view+' '+$canonicalGui) -Purpose 'Restore the exact historical NSIS RUNASADMIN recipe for this authenticated old GUI; no sandbox override.'
      $key.SetValue($canonicalGui,$expected,[Microsoft.Win32.RegistryValueKind]::String);$key.Flush()
      $actual=$key.GetValue($canonicalGui,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if($actual -isnot [string] -or $actual -cne $expected -or $key.GetValueKind($canonicalGui) -ne [Microsoft.Win32.RegistryValueKind]::String){throw 'Original compatibility value readback differs.'}
      $row.after=$actual;$row.readbackConfirmed=$true
    }finally{if($null -ne $key){$key.Dispose()};if($null -ne $base){$base.Dispose()}}
  }
  return [ordered]@{kind='restored-original-nsis-compatibility-recipe';sourceCommit=$sourceCommit;sourcePath='src/installer/setup.nsi';originalVersion=$OriginalVersion;value=$expected;rows=$rows;originalSetupExecuted=$false;completeNsisRegistrationsRestored=$false;gpuFailureFixed=$false;sourceRecipeIsAuthenticatedInstallerBytecode=$false}
}

function Invoke-RestoredLegacyBaseline {
  [CmdletBinding()]
  param(
    [ValidateSet('3.7.8','3.7.9')][string]$OriginalVersion,
    [string]$AuthenticatedInstaller,
    [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedInstallerSha256,
    [ValidatePattern('^[a-f0-9]{128}$')][string]$ExpectedInstallerSha512,
    [long]$ExpectedInstallerBytes,
    [string]$InstallationRoot,
    [string]$WorkDirectory,
    [string]$EvidenceDirectory,
    [string]$NodePath,
    [string]$PowerShellPath
  )
  $baselineEnvironment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$baselineEnvironment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $baselineWindows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $baselineAdministrator=$baselineWindows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $baselineErrors=@(Get-NativeAcceptanceEnvironmentErrors -Environment $baselineEnvironment -Administrator $baselineAdministrator -Windows $baselineWindows)
  if($baselineErrors.Count -ne 0){throw ('Restored legacy baseline host guard refused before mutation: '+($baselineErrors -join ', '))}
  if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){throw 'Restored baseline requires native PowerShell 7 x64.'}
  $canonical=[IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield')).TrimEnd('\')
  if([IO.Path]::GetFullPath($InstallationRoot).TrimEnd('\') -ine $canonical -or $script:InstallRoot -ine $canonical){throw 'Restored baseline must use the existing harness canonical Program Files root.'}
  foreach($entry in @($AuthenticatedInstaller,$WorkDirectory,$EvidenceDirectory)){[void](Assert-NativePathWithin -Path $entry -Root $env:RUNNER_TEMP)}
  Assert-NativeOrdinaryPath -Path $AuthenticatedInstaller -Leaf
  Assert-NativeOrdinaryPath -Path $WorkDirectory
  Assert-NativeOrdinaryPath -Path $EvidenceDirectory
  foreach($entry in @($NodePath,$PowerShellPath,$script:NativeLegacyBaselineNodeHelper)){Assert-NativeOrdinaryPath -Path $entry -Leaf}
  $nativePowerShell=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if($PowerShellPath -ine $nativePowerShell){throw 'Original phases require the canonical native Windows PowerShell 5.1.'}
  Assert-NativeCleanStart
  if(Test-Path -LiteralPath $canonical){throw 'Restored baseline destination already exists.'}
  $baselineWork=Join-Path $WorkDirectory ('restored-original-'+$OriginalVersion)
  $baselineEvidence=Join-Path $EvidenceDirectory ('restored-original-'+$OriginalVersion)
  if((Test-Path -LiteralPath $baselineWork) -or (Test-Path -LiteralPath $baselineEvidence)){throw 'Restored baseline work/evidence must be fresh.'}
  $sevenZip=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) '7-Zip\7z.exe'
  Assert-NativeOrdinaryPath -Path $sevenZip -Leaf
  [void](New-Item -ItemType Directory -Path $baselineWork,$baselineEvidence)
  $baselineReceipt=[ordered]@{schemaVersion=1;kind='restored-authenticated-legacy-native-baseline';originalVersion=$OriginalVersion;originalSetupExecuted=$false;oldOriginalSetupExecuted=$false;sourceCommit=[string]$baselineEnvironment.GITHUB_SHA;installationRoot=$canonical;result='running';generatedMetadata=@();payloadReadbacks=@();adapterMutations=0;originalNsisRegistrationsRestored=$false;originalUninstallerGenerated=$false;releaseAcceptance=$false}
  $baselineReceiptPath=Join-Path $baselineEvidence 'restored-legacy-baseline.json'
  $baselineReceipt.receiptPath=$baselineReceiptPath
  $preparePath=Join-Path $baselineWork 'prepared-original.json'
  $options=[ordered]@{originalVersion=$OriginalVersion;installer=$AuthenticatedInstaller;expectedSha256=$ExpectedInstallerSha256;expectedSha512=$ExpectedInstallerSha512;expectedBytes=$ExpectedInstallerBytes;workDirectory=$baselineWork;sevenZipExecutable=$sevenZip;sourceCommit=[string]$baselineEnvironment.GITHUB_SHA;output=$preparePath}
  $optionsPath=Join-Path $baselineWork 'prepare.options.json';$options|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $optionsPath -Encoding utf8
  try{
    [void](Invoke-NativeBounded -Executable $NodePath -Arguments @($script:NativeLegacyBaselineNodeHelper,'prepare',$optionsPath) -Label ('restore-'+$OriginalVersion+'-authenticate-extract') -TimeoutSeconds 420)
    Assert-NativeOrdinaryPath -Path $preparePath -Leaf
    $prepared=Get-Content -LiteralPath $preparePath -Raw|ConvertFrom-Json
    if($prepared.kind -cne 'authenticated-original-extraction' -or $prepared.originalVersion -cne $OriginalVersion -or $prepared.originalSetupExecuted -ne $false){throw 'Authenticated extraction receipt identity invalid.'}
    [void](Assert-NativePathWithin -Path $prepared.payloadRoot -Root $baselineWork);Assert-NativeOrdinaryPath -Path $prepared.payloadRoot
    $baselineReceipt.authenticatedExtraction=$prepared
    $baselineBeforeNetwork=Get-NativeNetworkFingerprint
    Add-NativeMutation -Kind 'restore-authenticated-original-payload' -Target $canonical -Purpose 'Restore authenticated legacy binaries for a separate real SCM/GUI/helper handoff test; original Setup is not executed.'
    [void](New-Item -ItemType Directory -Path $canonical)
    foreach($entry in $prepared.payload){
      $relative=[string]$entry.path
      if(-not $relative -or $relative -match '[\\:]' -or $relative -match '(^|/)(\.|\.\.)($|/)'){throw 'Restored payload path invalid.'}
      $source=Assert-NativePathWithin -Path (Join-Path $prepared.payloadRoot $relative) -Root $prepared.payloadRoot
      $target=Assert-NativePathWithin -Path (Join-Path $canonical $relative) -Root $canonical
      Assert-NativeOrdinaryPath -Path $source -Leaf
      $parent=[IO.Path]::GetDirectoryName($target);if(-not (Test-Path -LiteralPath $parent)){[void](New-Item -ItemType Directory -Path $parent -Force)}
      Assert-NativeOrdinaryPath -Path $parent
      Copy-Item -LiteralPath $source -Destination $target -ErrorAction Stop
    }
    $beforeMetadata=[ordered]@{preparedReceipt=$preparePath;installationRoot=$canonical;generatedMetadata=@();sourceCommit=[string]$baselineEnvironment.GITHUB_SHA;output=(Join-Path $baselineWork 'payload-before-metadata.json')}
    $verifyPath=Join-Path $baselineWork 'before-metadata.options.json';$beforeMetadata|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $verifyPath -Encoding utf8
    [void](Invoke-NativeBounded -Executable $NodePath -Arguments @($script:NativeLegacyBaselineNodeHelper,'verify-installed',$verifyPath) -Label ('restore-'+$OriginalVersion+'-payload-before-metadata') -TimeoutSeconds 300)
    $baselineReceipt.payloadReadbacks+=Get-Content -LiteralPath $beforeMetadata.output -Raw|ConvertFrom-Json
    $identityPath=Join-Path $canonical 'resources\installation.json'
    if(Test-Path -LiteralPath $identityPath){throw 'Generated identity must be fresh and separate from original payload.'}
    $identityId=[Guid]::NewGuid().ToString()
    $metadataVersion=[string]$prepared.sourceRecipe.originalMetadataVersion
    [IO.File]::WriteAllText($identityPath,(@{id=$identityId;version=$metadataVersion}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    $baselineReceipt.generatedMetadata=@([ordered]@{path='resources/installation.json';bytes=(Get-Item -LiteralPath $identityPath).Length;sha256=(Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant();sourceRecipe=$prepared.sourceRecipe;id=$identityId;version=$metadataVersion;authenticatedPackageVersion=$OriginalVersion;versionSource='exact-original-PostInstall-recipe';signedPayload=$false})
    [void](Assert-NativeAdministratorOwned -Path $canonical -InstallationPath)
    $baselineReceipt.originalCompatibilityRecipe=Set-RestoredOriginalCompatibility -OriginalVersion $OriginalVersion -GuiPath (Join-Path $canonical 'EgoistShield.exe')
    $cleanup=Join-Path $canonical 'resources\installer\owned-cleanup.ps1'
    if((Get-FileHash -LiteralPath $cleanup -Algorithm SHA256).Hash -ine 'c7eca1981c0aa2eb237f1db29c0acfa2fe62a0756ef292efb97339815011f44e'){throw 'Original Core registration phase bytes changed.'}
    Add-NativeMutation -Kind 'original-core-registration-phase' -Target $cleanup -Purpose 'Execute unchanged authenticated InstallCoreService phase: original Core configure and actual SCM recovery registration.'
    $baselineReceipt.coreInstall=[ordered]@{helperSha256='c7eca1981c0aa2eb237f1db29c0acfa2fe62a0756ef292efb97339815011f44e';phase='InstallCoreService';command='original Core configure --install-root; original sc.exe registration/start'}
    [void](Invoke-NativeBounded -Executable $PowerShellPath -Arguments @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$cleanup,'-Phase','InstallCoreService','-InstallRoot',$canonical) -Label ('restore-'+$OriginalVersion+'-original-core-phase') -TimeoutSeconds 90)
    Assert-NativeOrdinaryPath -Path $identityPath -Leaf
    if((Get-Item -LiteralPath $identityPath).Length -gt 4096){throw 'Actual original Core phase identity metadata exceeded its bound.'}
    $identityAfter=Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json
    if([string]$identityAfter.id -cne $identityId -or [string]$identityAfter.version -cnotin @($metadataVersion,$OriginalVersion)){throw 'Actual original Core phase changed identity outside the original package contract.'}
    $identityHashAfter=(Get-FileHash -LiteralPath $identityPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $baselineReceipt.generatedMetadata[0].beforeCoreSha256=$baselineReceipt.generatedMetadata[0].sha256
    $baselineReceipt.generatedMetadata[0].changedDuringOriginalCorePhase=($identityHashAfter -cne $baselineReceipt.generatedMetadata[0].sha256)
    $baselineReceipt.generatedMetadata[0].sha256=$identityHashAfter
    $baselineReceipt.generatedMetadata[0].bytes=(Get-Item -LiteralPath $identityPath).Length
    $baselineReceipt.generatedMetadata[0].version=[string]$identityAfter.version
    $core=Join-Path $canonical 'resources\core-service\win-x64\EgoistShield.Service.exe'
    $baselineReceipt.core=Assert-NativeService -Name 'EgoistShieldCore' -Executable $core -Running
    $baselineReceipt.corePolicy=Get-NativeRecoveryPolicy -Name 'EgoistShieldCore'
    if($baselineReceipt.corePolicy.resetSeconds -ne 86400 -or $baselineReceipt.corePolicy.actions.Count -ne 3 -or (@($baselineReceipt.corePolicy.actions|ForEach-Object {$_.delayMs}) -join ',') -cne '5000,15000,30000'){throw 'Original Core recovery policy differs.'}
    $generated=@($baselineReceipt.generatedMetadata|ForEach-Object {[ordered]@{path=$_.path;bytes=$_.bytes;sha256=$_.sha256}})
    $afterCore=[ordered]@{preparedReceipt=$preparePath;installationRoot=$canonical;generatedMetadata=$generated;sourceCommit=[string]$baselineEnvironment.GITHUB_SHA;output=(Join-Path $baselineWork 'payload-after-core.json')}
    $verifyPath=Join-Path $baselineWork 'after-core.options.json';$afterCore|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $verifyPath -Encoding utf8
    [void](Invoke-NativeBounded -Executable $NodePath -Arguments @($script:NativeLegacyBaselineNodeHelper,'verify-installed',$verifyPath) -Label ('restore-'+$OriginalVersion+'-payload-after-core') -TimeoutSeconds 300)
    $baselineReceipt.payloadReadbacks+=Get-Content -LiteralPath $afterCore.output -Raw|ConvertFrom-Json
    $baselineAfterNetwork=Get-NativeNetworkFingerprint
    $baselineReceipt.networkPreserved=($baselineBeforeNetwork|ConvertTo-Json -Depth 12 -Compress) -ceq ($baselineAfterNetwork|ConvertTo-Json -Depth 12 -Compress)
    if(-not $baselineReceipt.networkPreserved){throw 'Restored Core phase changed measured network state.'}
    $baselineReceipt.result='baseline-ready';$baselineReceipt.guiAndHelperHandoffTested=$false
    return $baselineReceipt
  }catch{$baselineReceipt.result='failed';$baselineReceipt.error=$_.Exception.Message;throw}
  finally{
    $baselineReceipt|ConvertTo-Json -Depth 28|Set-Content -LiteralPath $baselineReceiptPath -Encoding utf8
    foreach($entry in @(Get-ChildItem -LiteralPath $baselineWork -File)){Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $baselineEvidence $entry.Name) -ErrorAction Stop}
  }
}

if(-not $LibraryOnly){throw 'Load this helper with -LibraryOnly and call Invoke-RestoredLegacyBaseline from the guarded native harness.'}
