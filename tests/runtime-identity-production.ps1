param([Parameter(Mandatory = $true)][string]$WorkRoot)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($WorkRoot)) { throw 'Use the absolute task-owned work directory.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workDirectory = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('ib-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void][IO.Directory]::CreateDirectory($workDirectory)
$sdkRoot = Join-Path $projectRoot '.tools/dotnet-10.0.401'
$sdk = if ($env:SHIELD_DOTNET) { $env:SHIELD_DOTNET } else { Join-Path $sdkRoot 'dotnet.exe' }
if (-not (Test-Path -LiteralPath $sdk -PathType Leaf)) { throw 'The pinned .NET SDK is missing.' }
$frozen = Join-Path $workDirectory 'src'; [void][IO.Directory]::CreateDirectory($frozen)
$sources = @('ProtectedExecutable.cs', 'ClientAuthorizer.cs', 'ClientIdentity.cs', 'ServiceOptions.cs', 'ServiceConfig.cs', 'TrustedPath.cs', 'GuiLaunchPolicy.cs', 'ComponentWorker.cs', 'ServiceOperationException.cs')
$sourceHashes = @()
foreach ($name in $sources) {
    $original = Join-Path $projectRoot ('src/service/EgoistShield.Service/' + $name)
    $destination = Join-Path $frozen $name
    [IO.File]::WriteAllBytes($destination, [IO.File]::ReadAllBytes($original))
    $sourceHashes += @{file=$name; sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash}
}
[IO.File]::WriteAllText((Join-Path $workDirectory 'source-hashes.json'), ($sourceHashes | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$source = [Security.SecurityElement]::Escape($frozen)
$harness = [Security.SecurityElement]::Escape((Join-Path $PSScriptRoot 'runtime-identity-production.cs'))
$project = @"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget><LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks><EnableDefaultCompileItems>false</EnableDefaultCompileItems><StartupObject>RuntimeIdentityProduction.TestProgram</StartupObject></PropertyGroup><ItemGroup><Compile Include="$source\*.cs"/><Compile Include="$harness"/></ItemGroup></Project>
"@
$projectFile = Join-Path $workDirectory 'IdentityRuntimeProduction.csproj'
[IO.File]::WriteAllText($projectFile, $project, [Text.UTF8Encoding]::new($false))
$saved = @{}
foreach ($name in @('TMP','TEMP','DOTNET_ROOT','DOTNET_CLI_HOME','DOTNET_CLI_TELEMETRY_OPTOUT')) { $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
try {
    $env:TEMP=$workDirectory; $env:TMP=$workDirectory; $env:DOTNET_ROOT=[IO.Path]::GetDirectoryName($sdk)
    $env:DOTNET_CLI_HOME=Join-Path $workDirectory 'dotnet-home'; $env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
    & $sdk build $projectFile -c Release --nologo *> (Join-Path $workDirectory 'build.txt')
    if ($LASTEXITCODE -ne 0) { throw "Identity build failed: $workDirectory\build.txt" }
    $executable=Join-Path $workDirectory 'bin/Release/net10.0-windows/IdentityRuntimeProduction.exe'
    & $executable --work ([IO.Path]::GetFullPath($WorkRoot)) *> (Join-Path $workDirectory 'run.txt')
    $result=$LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $workDirectory 'run.txt')
    Write-Output ('NATIVE_ARGUMENT_PROBE=' + $executable)
    Write-Output ('BUILD_EVIDENCE=' + $workDirectory)
    if ($result -ne 0) { throw "Identity native regression failed; evidence preserved: $workDirectory" }
}
finally { foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') } }
