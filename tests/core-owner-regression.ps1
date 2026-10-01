param(
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [string]$DotnetPath = $env:SHIELD_DOTNET
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($WorkRoot)) { throw 'Use an absolute owned work root.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdk = if ($DotnetPath) { $DotnetPath } else { Join-Path $projectRoot '.tools/dotnet-10.0.401/dotnet.exe' }
if (-not [IO.Path]::IsPathFullyQualified($sdk) -or -not [IO.File]::Exists($sdk) -or ((Get-Item -LiteralPath $sdk).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A pinned ordinary absolute SDK executable is required.' }
$requiredSdk = (Get-Content -LiteralPath (Join-Path $projectRoot 'global.json') -Raw | ConvertFrom-Json).sdk.version
$actualSdk = (& $sdk --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $actualSdk -ne $requiredSdk) { throw "Expected SDK $requiredSdk; received $actualSdk." }
$work = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('core-owner-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
[void][IO.Directory]::CreateDirectory($work)
$sourceRoot = Join-Path $work 'source'
$hashes = @()
$liveRoot = Join-Path $projectRoot 'src/service'
foreach ($file in (Get-ChildItem -LiteralPath $liveRoot -Recurse -File -Filter '*.cs' | Where-Object FullName -NotMatch '[\\/](obj|bin)[\\/]')) {
    $relative = [IO.Path]::GetRelativePath($liveRoot, $file.FullName)
    $target = Join-Path $sourceRoot $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    [IO.File]::WriteAllBytes($target, [IO.File]::ReadAllBytes($file.FullName))
    $hashes += @{file=$relative.Replace('\','/');sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash}
}
$harness = Join-Path $work 'core-owner-regression.cs'
[IO.File]::WriteAllBytes($harness, [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'core-owner-regression.cs')))
$escapedRoot = [Security.SecurityElement]::Escape($sourceRoot)
$escapedHarness = [Security.SecurityElement]::Escape($harness)
$project = Join-Path $work 'CoreOwnerRegression.csproj'
@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><RuntimeFrameworkVersion>10.0.12</RuntimeFrameworkVersion><LangVersion>14.0</LangVersion><PlatformTarget>x64</PlatformTarget><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks><GenerateAssemblyInfo>false</GenerateAssemblyInfo><EnableDefaultCompileItems>false</EnableDefaultCompileItems><StartupObject>CoreOwnerRegression.TestProgram</StartupObject></PropertyGroup><ItemGroup><PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.0"/><Compile Include="$escapedRoot/**/*.cs" Exclude="$escapedRoot/**/obj/**/*.cs;$escapedRoot/**/bin/**/*.cs"/><Compile Include="$escapedHarness"/></ItemGroup></Project>
"@ | Set-Content -LiteralPath $project -Encoding utf8
$saved = @{}
foreach ($name in @('DOTNET_ROOT','DOTNET_CLI_HOME','NUGET_PACKAGES','TEMP','TMP','DOTNET_CLI_TELEMETRY_OPTOUT')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:DOTNET_ROOT = [IO.Path]::GetDirectoryName($sdk)
    $env:DOTNET_CLI_HOME = Join-Path $work 'dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $work 'nuget'
    $env:TEMP = $work; $env:TMP = $work; $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    & $sdk build $project -c Release --nologo *> (Join-Path $work 'build.log')
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) { throw "Focused build failed; evidence preserved at $work/build.log" }
    & (Join-Path $work 'bin/Release/net10.0-windows/CoreOwnerRegression.exe') $work *> (Join-Path $work 'run.log')
    $runExitCode = $LASTEXITCODE
    $receipt = @{schemaVersion=1; sdkVersion=$actualSdk; buildExitCode=$buildExitCode; runExitCode=$runExitCode; sourceHashes=$hashes; harnessSha256=(Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash; runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash}
    if ([IO.File]::Exists((Join-Path $work 'results.json'))) { $receipt.results = Get-Content -LiteralPath (Join-Path $work 'results.json') -Raw | ConvertFrom-Json }
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $work 'receipt.json') -Encoding utf8
    Write-Output ('EVIDENCE=' + (Join-Path $work 'receipt.json'))
    if ($runExitCode -ne 0) { throw "Focused regressions failed; evidence preserved at $work/run.log" }
}
finally { foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') } }
