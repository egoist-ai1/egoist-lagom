param(
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [string]$DotnetPath = $env:SHIELD_DOTNET,
    [ValidateSet('all', 'verification', 'atomic', 'degraded', 'configuration', 'intents', 'vpn', 'budgets', 'route', 'selftest')][string]$Case = 'all',
    [ValidateRange(1, 100000)][int]$Replaces = 10000,
    [ValidateRange(1, 500000)][int]$Reads = 50000
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($WorkRoot)) { throw 'Use the absolute work path returned for this task by brain task paths.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workDirectory = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('cp-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void](New-Item -ItemType Directory -Path $workDirectory)
$sdk = if ([string]::IsNullOrWhiteSpace($DotnetPath)) { Join-Path $projectRoot '.tools/dotnet-10.0.401/dotnet.exe' } else { $DotnetPath }
if (-not [IO.Path]::IsPathFullyQualified($sdk) -or -not (Test-Path -LiteralPath $sdk -PathType Leaf) -or
    ([IO.File]::GetAttributes($sdk) -band [IO.FileAttributes]::ReparsePoint)) { throw 'Use an absolute ordinary file for the pinned dotnet executable.' }
$sdk = [IO.Path]::GetFullPath($sdk)
$sdkRoot = [IO.Path]::GetDirectoryName($sdk)
$expectedSdk = [string](Get-Content -LiteralPath (Join-Path $projectRoot 'global.json') -Raw | ConvertFrom-Json).sdk.version
$actualSdk = (& $sdk --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actualSdk -cne $expectedSdk) { throw "Expected SDK $expectedSdk; actual SDK $actualSdk." }
$liveSourceRoot = Join-Path $projectRoot 'src/service'
$frozenSourceRoot = Join-Path $workDirectory 'source'
$sourceHashes = @()
foreach ($sourceFile in (Get-ChildItem -LiteralPath $liveSourceRoot -Recurse -File -Filter '*.cs' | Where-Object FullName -NotMatch '[\\/](obj|bin)[\\/]' | Sort-Object FullName)) {
    $relative = [IO.Path]::GetRelativePath($liveSourceRoot, $sourceFile.FullName)
    $frozenPath = Join-Path $frozenSourceRoot $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($frozenPath))
    [IO.File]::WriteAllBytes($frozenPath, [IO.File]::ReadAllBytes($sourceFile.FullName))
    $sourceHashes += @{file = $relative.Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $frozenPath -Algorithm SHA256).Hash}
}
$sourceHashes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workDirectory 'source-hashes.json') -Encoding utf8
$sourceRoot = [Security.SecurityElement]::Escape($frozenSourceRoot)
$frozenHarnessPath = Join-Path $workDirectory 'core-persistence-production.cs'
[IO.File]::WriteAllBytes($frozenHarnessPath, [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'core-persistence-production.cs')))
$frozenRunnerPath = Join-Path $workDirectory 'core-persistence-production.ps1'
[IO.File]::WriteAllBytes($frozenRunnerPath, [IO.File]::ReadAllBytes($PSCommandPath))
@{
    schemaVersion = 1; sourceFileCount = $sourceHashes.Count; sdkVersion = $actualSdk; sdk = $sdk
    case = $Case; replaces = $Replaces; reads = $Reads
    harnessSha256 = (Get-FileHash -LiteralPath $frozenHarnessPath -Algorithm SHA256).Hash
    runnerSha256 = (Get-FileHash -LiteralPath $frozenRunnerPath -Algorithm SHA256).Hash
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workDirectory 'runner-metadata.json') -Encoding utf8
$harness = [Security.SecurityElement]::Escape($frozenHarnessPath)
$projectText = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget>
    <LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo><EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <StartupObject>CorePersistenceProduction.TestProgram</StartupObject><AssemblyName>CorePersistenceProduction</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.0" />
    <Compile Include="$sourceRoot\**\*.cs" Exclude="$sourceRoot\obj\**\*.cs;$sourceRoot\bin\**\*.cs" />
    <Compile Include="$harness" />
  </ItemGroup>
</Project>
"@
$projectPath = Join-Path $workDirectory 'CorePersistenceProduction.csproj'
[IO.File]::WriteAllText($projectPath, $projectText, [Text.UTF8Encoding]::new($false))
$savedEnvironment = @{}
foreach ($name in @('TMP', 'TEMP', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'DOTNET_CLI_TELEMETRY_OPTOUT')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:TMP = $workDirectory; $env:TEMP = $workDirectory; $env:DOTNET_ROOT = $sdkRoot
    $env:DOTNET_CLI_HOME = Join-Path $workDirectory 'dotnet-home'
    $env:NUGET_PACKAGES = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) 'nuget'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    & $sdk build $projectPath -c Release --nologo *> (Join-Path $workDirectory 'build.log')
    if ($LASTEXITCODE -ne 0) { throw "Build failed; inspect $workDirectory\build.log" }
    & (Join-Path $workDirectory 'bin/Release/net10.0-windows/CorePersistenceProduction.exe') --work $workDirectory --case $Case --replaces $Replaces --reads $Reads *> (Join-Path $workDirectory 'run.log')
    $harnessExitCode = $LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $workDirectory 'run.log')
    if (Test-Path -LiteralPath (Join-Path $workDirectory 'results.json') -PathType Leaf) { Write-Output ('EVIDENCE=' + (Join-Path $workDirectory 'results.json')) }
    else { Write-Output ('RUN_LOG=' + (Join-Path $workDirectory 'run.log')) }
    if ($harnessExitCode -ne 0) { throw "Production regression failed; evidence preserved: $workDirectory" }
}
finally { foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') } }
