param(
    [Parameter(Mandatory = $true)][string]$WorkRoot,
    [string]$Case = 'all'
)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathFullyQualified($WorkRoot)) { throw 'WorkRoot must be the absolute task-owned work path returned by brain task paths.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$workDirectory = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('sa-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
[void](New-Item -ItemType Directory -Path $workDirectory)
$sdkRoot = Join-Path $projectRoot '.tools/dotnet-10.0.401'
$sdk = Join-Path $sdkRoot 'dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk -PathType Leaf)) { throw 'The project-pinned .NET SDK 10.0.401 is missing.' }
$sourceRoot = [Security.SecurityElement]::Escape((Join-Path $projectRoot 'src/service'))
$harness = [Security.SecurityElement]::Escape((Join-Path $PSScriptRoot 'ServiceAuditStress.cs'))
$projectText = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget>
    <LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo><EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <StartupObject>ServiceAuditStress.AuditProgram</StartupObject><AssemblyName>ServiceAuditStress</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.0" />
    <Compile Include="$sourceRoot\**\*.cs" Exclude="$sourceRoot\obj\**\*.cs;$sourceRoot\bin\**\*.cs" />
    <Compile Include="$harness" />
  </ItemGroup>
</Project>
"@
$projectPath = Join-Path $workDirectory 'ServiceAuditStress.csproj'
[IO.File]::WriteAllText($projectPath, $projectText, [Text.UTF8Encoding]::new($false))
$savedEnvironment = @{}
foreach ($name in @('TMP', 'TEMP', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'DOTNET_CLI_TELEMETRY_OPTOUT')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:TMP = $workDirectory; $env:TEMP = $workDirectory; $env:DOTNET_ROOT = $sdkRoot
    $env:DOTNET_CLI_HOME = Join-Path $workDirectory 'dotnet-home'
    $env:NUGET_PACKAGES = Join-Path ([IO.Path]::GetFullPath($WorkRoot)) 'nuget'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    & $sdk build $projectPath -c Release --nologo *> (Join-Path $workDirectory 'build.log')
    if ($LASTEXITCODE -ne 0) { throw "Harness build failed; inspect $workDirectory\build.log" }
    $arguments = @('--work', $workDirectory)
    if ($Case -ne 'all') { $arguments += @('--case', $Case) }
    & (Join-Path $workDirectory 'bin/Release/net10.0-windows/ServiceAuditStress.exe') @arguments *> (Join-Path $workDirectory 'run.log')
    $harnessExitCode = $LASTEXITCODE
    Get-Content -LiteralPath (Join-Path $workDirectory 'run.log')
    Write-Output ('EVIDENCE=' + (Join-Path $workDirectory 'native-service-stress/results.json'))
    if ($harnessExitCode -ne 0) { throw "The harness could not complete; preserved evidence: $workDirectory" }
}
finally { foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') } }
