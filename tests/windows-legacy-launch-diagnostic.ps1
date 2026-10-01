[CmdletBinding()]
param([Alias('LibraryOnly')][switch]$LegacyLaunchDiagnosticLibraryOnly)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:LegacyLaunchDiagnosticTestsRoot=$PSScriptRoot
$script:LegacyLaunchDiagnosticGuards=& {
  . (Join-Path $PSScriptRoot 'windows-production-acceptance.ps1') -LibraryOnly
  return @{
    Environment=(Get-Command Get-NativeAcceptanceEnvironmentErrors -CommandType Function).ScriptBlock
    Path=(Get-Command Assert-NativeOrdinaryPath -CommandType Function).ScriptBlock
    Within=(Get-Command Assert-NativePathWithin -CommandType Function).ScriptBlock
    AdministratorOwned=(Get-Command Assert-NativeAdministratorOwned -CommandType Function).ScriptBlock
  }
}

function Get-LegacyLaunchDiagnosticEnvironmentErrors {
  param([hashtable]$Environment,[bool]$Administrator,[bool]$Windows)
  $complete=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$complete[$name]=$Environment[$name]}
  return @(& $script:LegacyLaunchDiagnosticGuards.Environment -Environment $complete -Administrator $Administrator -Windows $Windows)
}

function Build-LegacyLaunchDiagnostic {
  param([Parameter(Mandatory=$true)][string]$WorkRoot)
  if(-not [IO.Path]::IsPathRooted($WorkRoot)){throw 'Absolute owned diagnostic work directory required.'}
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $WorkRoot
  $directory=Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('legacy-launch-diagnostic-'+[Guid]::NewGuid().ToString('N'))
  $projectRoot=[IO.Path]::GetFullPath((Join-Path $script:LegacyLaunchDiagnosticTestsRoot '..'))
  if($env:SHIELD_DOTNET){
    $sdk=[IO.Path]::GetFullPath($env:SHIELD_DOTNET)
    if(-not (Test-Path -LiteralPath $sdk -PathType Leaf)){throw 'Explicit SHIELD_DOTNET does not exist.'}
  }else{
    $sdk=Join-Path $projectRoot '.tools\dotnet-10.0.401\dotnet.exe'
    if(-not (Test-Path -LiteralPath $sdk -PathType Leaf)){$sdk=[string](Get-Command dotnet -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source}
  }
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $sdk -Leaf
  $globalJson=Join-Path $projectRoot 'global.json'
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $globalJson -Leaf
  $expectedSdk=[string](Get-Content -LiteralPath $globalJson -Raw|ConvertFrom-Json).sdk.version
  if($expectedSdk -cne '10.0.401'){throw 'Legacy launch diagnostic requires the reviewed SDK 10.0.401 pin.'}
  [void][IO.Directory]::CreateDirectory($directory)
  $source=Join-Path $directory 'windows-legacy-launch-diagnostic.cs'
  [IO.File]::WriteAllBytes($source,[IO.File]::ReadAllBytes((Join-Path $script:LegacyLaunchDiagnosticTestsRoot 'windows-legacy-launch-diagnostic.cs')))
  $sourceHashes=@(
    [ordered]@{file='tests/windows-legacy-launch-diagnostic.cs';sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()},
    [ordered]@{file='tests/windows-legacy-launch-diagnostic.ps1';sha256=(Get-FileHash -LiteralPath (Join-Path $script:LegacyLaunchDiagnosticTestsRoot 'windows-legacy-launch-diagnostic.ps1') -Algorithm SHA256).Hash.ToLowerInvariant()}
  )
  $hashPath=Join-Path $directory 'source-hashes.json'
  [IO.File]::WriteAllText($hashPath,($sourceHashes|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
  $escaped=[Security.SecurityElement]::Escape($source)
  $project='<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><EnableDefaultCompileItems>false</EnableDefaultCompileItems><AssemblyName>LegacyLaunchDiagnostic</AssemblyName></PropertyGroup><ItemGroup><Compile Include="'+$escaped+'"/></ItemGroup></Project>'
  $projectFile=Join-Path $directory 'LegacyLaunchDiagnostic.csproj'
  [IO.File]::WriteAllText($projectFile,$project,[Text.UTF8Encoding]::new($false))
  $saved=@{}
  foreach($name in @('TEMP','TMP','DOTNET_ROOT','DOTNET_CLI_HOME','DOTNET_CLI_TELEMETRY_OPTOUT','DOTNET_GENERATE_ASPNET_CERTIFICATE','DOTNET_SKIP_FIRST_TIME_EXPERIENCE')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try{
    $env:TEMP=$directory;$env:TMP=$directory;$env:DOTNET_ROOT=[IO.Path]::GetDirectoryName($sdk)
    $env:DOTNET_CLI_HOME=Join-Path $directory 'dotnet-home';$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false';$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1'
    $actualSdk=((& $sdk --version) -join "`n").Trim()
    if($LASTEXITCODE -ne 0 -or $actualSdk -cne $expectedSdk){throw 'Actual SDK version differs from global.json 10.0.401.'}
    & $sdk build $projectFile -c Release --nologo *> (Join-Path $directory 'build.txt')
    if($LASTEXITCODE -ne 0){throw "Legacy launch diagnostic build failed: $directory\build.txt"}
  }finally{
    foreach($name in $saved.Keys){
      if($null -eq $saved[$name]){Remove-Item -LiteralPath ('Env:'+$name) -ErrorAction SilentlyContinue}
      else{[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
    }
  }
  $executable=Join-Path $directory 'bin\Release\net10.0-windows\LegacyLaunchDiagnostic.exe'
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $executable -Leaf
  return [pscustomobject]@{Directory=$directory;Executable=$executable;DotnetRoot=[IO.Path]::GetDirectoryName($sdk);SdkVersion=$actualSdk;SourceHashes=$hashPath;BuildLog=(Join-Path $directory 'build.txt')}
}

function Invoke-LegacyLaunchDiagnostic {
  param(
    [Parameter(Mandatory=$true)][string]$InstalledGuiPath,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedGuiSha256,
    [Parameter(Mandatory=$true)][ValidateSet('3.7.8','3.7.9')][string]$ExpectedOldVersion,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSourceCommit
  )
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  $windows=[Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
  $administrator=$windows -and ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(Get-LegacyLaunchDiagnosticEnvironmentErrors -Environment $environment -Administrator $administrator -Windows $windows)
  if($errors.Count -ne 0){throw ('Legacy launch diagnostic hosted guard refused before product lookup: '+($errors -join ', '))}
  if($ExpectedSourceCommit -cne $env:GITHUB_SHA){throw 'Legacy launch diagnostic source must match actual GITHUB_SHA.'}
  $pins=@{'3.7.8'='1f7e25830864a04589805254d32c84c8ded7b0e8b2c74a0b7c11c2eee49e80da';'3.7.9'='a031b05eb84a0526ca09e98f1ca1e9145567121190be6b83b5b3c2fe2805192b'}
  if($ExpectedGuiSha256 -cne $pins[$ExpectedOldVersion]){throw 'Legacy launch diagnostic requires the fixed original GUI hash.'}
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $env:RUNNER_TEMP
  [void](& $script:LegacyLaunchDiagnosticGuards.Within -Path $WorkRoot -Root $env:RUNNER_TEMP)
  [void](& $script:LegacyLaunchDiagnosticGuards.Within -Path $EvidenceDirectory -Root $env:RUNNER_TEMP)
  [void](& $script:LegacyLaunchDiagnosticGuards.Within -Path $EvidenceDirectory -Root $WorkRoot)
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $WorkRoot
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $EvidenceDirectory
  $canonical=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\EgoistShield.exe'
  if([IO.Path]::GetFullPath($InstalledGuiPath) -ine $canonical){throw 'Legacy diagnostic allows only canonical Program Files GUI.'}
  & $script:LegacyLaunchDiagnosticGuards.Path -Path $canonical -Leaf
  [void](& $script:LegacyLaunchDiagnosticGuards.AdministratorOwned -Path $canonical -InstallationPath)
  if((Get-FileHash -LiteralPath $canonical -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedGuiSha256){throw 'Legacy diagnostic actual GUI hash differs.'}
  $bounded=Get-Command Invoke-NativeBounded -CommandType Function -ErrorAction Stop
  $mutation=Get-Command Add-NativeMutation -CommandType Function -ErrorAction Stop
  $build=Build-LegacyLaunchDiagnostic -WorkRoot $WorkRoot
  $receipt=Join-Path $EvidenceDirectory ('legacy-launch-diagnostic-'+$ExpectedOldVersion+'-'+[Guid]::NewGuid().ToString('N')+'.json')
  $options=[ordered]@{installedGuiPath=$canonical;expectedGuiSha256=$ExpectedGuiSha256;expectedOldVersion=$ExpectedOldVersion;workRoot=[IO.Path]::GetFullPath($WorkRoot);evidenceDirectory=[IO.Path]::GetFullPath($EvidenceDirectory);expectedSourceCommit=$ExpectedSourceCommit;receiptPath=$receipt}
  $optionsPath=Join-Path $build.Directory 'options.json'
  [IO.File]::WriteAllText($optionsPath,($options|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
  [void](& $mutation -Kind 'native-legacy-suspended-launch-diagnostic' -Target $canonical -Purpose 'Sample immediate Win32 CreateProcessAsUserW errors; terminate only owned held children before execution; not GUI acceptance.')
  $savedRoot=[Environment]::GetEnvironmentVariable('DOTNET_ROOT','Process')
  try{
    $env:DOTNET_ROOT=$build.DotnetRoot
    [void](& $bounded -Executable $build.Executable -Arguments @('--run',$optionsPath) -Label ('legacy-launch-diagnostic-'+$ExpectedOldVersion) -TimeoutSeconds 120)
  }finally{
    if($null -eq $savedRoot){Remove-Item -LiteralPath 'Env:DOTNET_ROOT' -ErrorAction SilentlyContinue}
    else{[Environment]::SetEnvironmentVariable('DOTNET_ROOT',$savedRoot,'Process')}
  }
  $actual=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
  if($actual.kind -cne 'native-legacy-suspended-launch-boundary-diagnostic' -or $actual.result -cne 'diagnostic-complete' -or $actual.acceptance -ne $false -or $actual.actualChromiumGpuErrorCaptured -ne $false -or $actual.threadsResumed -ne 0 -or $actual.cleanupConfirmed -ne $true){throw 'Legacy launch diagnostic receipt failed its safety contract.'}
  if($actual.originalGui.sha256Before -cne $ExpectedGuiSha256 -or $actual.originalGui.sha256After -cne $ExpectedGuiSha256 -or @($actual.attempts).Count -ne 3){throw 'Legacy launch diagnostic original hash/attempt readback differs.'}
  return $receipt
}

if($LegacyLaunchDiagnosticLibraryOnly){return}
throw 'Import with -LibraryOnly and call the guarded Invoke-LegacyLaunchDiagnostic entrypoint.'
