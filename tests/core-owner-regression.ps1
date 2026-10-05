param(
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [string]$DotnetPath = $env:SHIELD_DOTNET
)
$ErrorActionPreference = 'Stop'
function Write-FailureLogTail([string]$Path) {
    try {
        if (-not [IO.File]::Exists($Path)) { Write-Output ('DIAGNOSTIC_LOG_MISSING=' + $Path); return }
        $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        try {
            $length = [int][Math]::Min(16384, $stream.Length)
            [void]$stream.Seek(-$length, [IO.SeekOrigin]::End)
            $buffer = [byte[]]::new($length)
            $read = 0
            while ($read -lt $length) {
                $count = $stream.Read($buffer, $read, $length - $read)
                if ($count -eq 0) { break }
                $read += $count
            }
            Write-Output ('DIAGNOSTIC_LOG_TAIL=' + $Path + '; maxBytes=16384')
            Write-Output ([Text.Encoding]::UTF8.GetString($buffer, 0, $read))
        }
        finally { $stream.Dispose() }
    }
    catch { Write-Output ('DIAGNOSTIC_LOG_READ_FAILED=' + $_.Exception.GetType().FullName) }
}
function Write-FailedGroups($Results) {
    try {
        if ($null -eq $Results) { Write-Output 'FAILED_GROUPS_UNAVAILABLE'; return }
        $failed = @($Results.results | Where-Object { $_.passed -eq $false } | Select-Object name, error, diagnostics)
        $text = ConvertTo-Json -InputObject $failed -Depth 8
        if ($text.Length -gt 16384) { $text = $text.Substring(0, 16384) + "`n[truncated; see preserved results.json]" }
        Write-Output ('FAILED_GROUP_COUNT=' + $failed.Count)
        Write-Output $text
    }
    catch { Write-Output ('FAILED_GROUPS_READ_FAILED=' + $_.Exception.GetType().FullName) }
}
if (-not [IO.Path]::IsPathFullyQualified($WorkRoot)) { throw 'Use an absolute owned work root.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdk = if ($DotnetPath) { $DotnetPath } else { Join-Path $projectRoot '.tools/dotnet-10.0.401/dotnet.exe' }
if (-not [IO.Path]::IsPathFullyQualified($sdk) -or -not [IO.File]::Exists($sdk) -or ((Get-Item -LiteralPath $sdk).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A pinned ordinary absolute SDK executable is required.' }
$requiredSdk = (Get-Content -LiteralPath (Join-Path $projectRoot 'global.json') -Raw | ConvertFrom-Json).sdk.version
$savedSdkToolsPath = [Environment]::GetEnvironmentVariable('DOTNET_ADD_GLOBAL_TOOLS_TO_PATH', 'Process')
try {
    $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH = '0'
    $actualSdk = (& $sdk --version | Out-String).Trim()
    $sdkVersionExitCode = $LASTEXITCODE
} finally { [Environment]::SetEnvironmentVariable('DOTNET_ADD_GLOBAL_TOOLS_TO_PATH', $savedSdkToolsPath, 'Process') }
if ($sdkVersionExitCode -ne 0 -or $actualSdk -ne $requiredSdk) { throw "Expected SDK $requiredSdk; received $actualSdk." }
$work = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('core-owner-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
[void][IO.Directory]::CreateDirectory($work)
Write-Output ('OWNER_EVIDENCE_DIR=' + $work)
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
$privateRootsHarness = Join-Path $work 'core-private-roots-production.cs'
[IO.File]::WriteAllBytes($privateRootsHarness, [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'core-private-roots-production.cs')))
$escapedPrivateRootsHarness = [Security.SecurityElement]::Escape($privateRootsHarness)
$historicalFixture = Join-Path $PSScriptRoot 'fixtures/AtomicJsonFile.ead2.cs'
$historicalSource = Join-Path $work 'AtomicJsonFile.ead2.cs'
if ((Get-Item -LiteralPath $historicalFixture).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Historical source fixture must be an ordinary file.' }
[IO.File]::WriteAllBytes($historicalSource, [IO.File]::ReadAllBytes($historicalFixture))
$historicalSha256 = (Get-FileHash -LiteralPath $historicalSource -Algorithm SHA256).Hash
if ($historicalSha256 -ne '1EE6256769F2D036DD93B114B6D89CD72BC1530CB3FDA9DEF7139873042FA231') { throw 'Historical AtomicJsonFile fixture bytes differ from the accepted snapshot.' }
$escapedRoot = [Security.SecurityElement]::Escape($sourceRoot)
$escapedHarness = [Security.SecurityElement]::Escape($harness)
$project = Join-Path $work 'CoreOwnerRegression.csproj'
$baselineProject = Join-Path $work 'baseline/OriginalAtomicFixture.csproj'
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($baselineProject))
$escapedHistorical = [Security.SecurityElement]::Escape($historicalSource)
@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0-windows</TargetFramework><RuntimeFrameworkVersion>10.0.12</RuntimeFrameworkVersion><LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><EnableDefaultCompileItems>false</EnableDefaultCompileItems></PropertyGroup><ItemGroup><Compile Include="$escapedHistorical"/><Compile Include="$escapedRoot/EgoistShield.Service/AtomicJsonReadResult.cs"/><Compile Include="$escapedRoot/EgoistShield.Service/JsonDefaults.cs"/></ItemGroup></Project>
"@ | Set-Content -LiteralPath $baselineProject -Encoding utf8
@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><RuntimeFrameworkVersion>10.0.12</RuntimeFrameworkVersion><LangVersion>14.0</LangVersion><PlatformTarget>x64</PlatformTarget><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks><GenerateAssemblyInfo>false</GenerateAssemblyInfo><EnableDefaultCompileItems>false</EnableDefaultCompileItems><StartupObject>CoreOwnerRegression.TestProgram</StartupObject></PropertyGroup><ItemGroup><PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.0"/><Compile Include="$escapedRoot/**/*.cs" Exclude="$escapedRoot/**/obj/**/*.cs;$escapedRoot/**/bin/**/*.cs"/><Compile Include="$escapedHarness"/><Compile Include="$escapedPrivateRootsHarness"/></ItemGroup></Project>
"@ | Set-Content -LiteralPath $project -Encoding utf8
$saved = @{}
foreach ($name in @('DOTNET_ROOT','DOTNET_CLI_HOME','DOTNET_ADD_GLOBAL_TOOLS_TO_PATH','NUGET_PACKAGES','TEMP','TMP','DOTNET_CLI_TELEMETRY_OPTOUT')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:DOTNET_ROOT = [IO.Path]::GetDirectoryName($sdk)
    $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='0'
    $env:DOTNET_CLI_HOME = Join-Path $work 'dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $work 'nuget'
    $env:TEMP = $work; $env:TMP = $work; $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    & $sdk build $baselineProject -c Release --nologo *> (Join-Path $work 'baseline-build.log')
    $baselineBuildExitCode = $LASTEXITCODE
    if ($baselineBuildExitCode -ne 0) {
        Write-FailureLogTail (Join-Path $work 'baseline-build.log')
        throw "Historical baseline build failed; evidence preserved at $work/baseline-build.log"
    }
    $baselineAssembly = Join-Path $work 'baseline/bin/Release/net10.0-windows/OriginalAtomicFixture.dll'
    & $sdk build $project -c Release --nologo *> (Join-Path $work 'build.log')
    $buildExitCode = $LASTEXITCODE
    if ($buildExitCode -ne 0) {
        Write-FailureLogTail (Join-Path $work 'build.log')
        throw "Focused build failed; evidence preserved at $work/build.log"
    }
    & (Join-Path $work 'bin/Release/net10.0-windows/CoreOwnerRegression.exe') $work $baselineAssembly *> (Join-Path $work 'run.log')
    $runExitCode = $LASTEXITCODE
    $receipt = @{schemaVersion=1; sdkVersion=$actualSdk; buildExitCode=$buildExitCode; runExitCode=$runExitCode; sourceHashes=$hashes; harnessSha256=(Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash; privateRootsHarnessSha256=(Get-FileHash -LiteralPath $privateRootsHarness -Algorithm SHA256).Hash; runnerSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash; historicalFixtureSha256=$historicalSha256; historicalAssemblySha256=(Get-FileHash -LiteralPath $baselineAssembly -Algorithm SHA256).Hash; baselineBuildExitCode=$baselineBuildExitCode}
    if ([IO.File]::Exists((Join-Path $work 'results.json'))) {
        try {
            if ((Get-Item -LiteralPath (Join-Path $work 'results.json')).Length -gt 1048576) { throw 'Focused results exceed the 1 MiB diagnostic limit.' }
            $receipt.results = Get-Content -LiteralPath (Join-Path $work 'results.json') -Raw | ConvertFrom-Json
        }
        catch { $receipt.resultsReadError = $_.Exception.GetType().FullName }
    }
    $receipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $work 'receipt.json') -Encoding utf8
    Write-Output ('EVIDENCE=' + (Join-Path $work 'receipt.json'))
    if ($runExitCode -ne 0) {
        Write-FailedGroups $receipt.results
        Write-FailureLogTail (Join-Path $work 'run.log')
        throw "Focused regressions failed; evidence preserved at $work/run.log"
    }
}
finally { foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') } }
