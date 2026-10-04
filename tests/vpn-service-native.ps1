param([Parameter(Mandatory=$true)][string]$WorkRoot, [string]$DotnetPath = $env:SHIELD_DOTNET)
$ErrorActionPreference='Stop'
if(-not [IO.Path]::IsPathFullyQualified($WorkRoot)){throw 'Use the current task absolute work root.'}
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$work=Join-Path $WorkRoot ('vpn-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
[void][IO.Directory]::CreateDirectory($work)
$sdk=if($DotnetPath){$DotnetPath}else{Join-Path $projectRoot '.tools/dotnet-10.0.401/dotnet.exe'}
if(-not [IO.Path]::IsPathFullyQualified($sdk) -or -not [IO.File]::Exists($sdk)){throw 'Pinned absolute SDK is required.'}
$sourceRoot=Join-Path $work 'source'
$hashes=@()
foreach($file in Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src/service') -Recurse -File -Filter '*.cs' | Where-Object FullName -NotMatch '[\\/](bin|obj)[\\/]'){
  $relative=[IO.Path]::GetRelativePath((Join-Path $projectRoot 'src/service'),$file.FullName)
  $target=Join-Path $sourceRoot $relative
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
  [IO.File]::WriteAllBytes($target,[IO.File]::ReadAllBytes($file.FullName))
  $hashes+=@{file=$relative.Replace('\','/');sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash}
}
$harness=Join-Path $work 'vpn-service-native.cs'
[IO.File]::WriteAllBytes($harness,[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'vpn-service-native.cs')))
$compileRoot=[Security.SecurityElement]::Escape($sourceRoot)
$compileHarness=[Security.SecurityElement]::Escape($harness)
$xml=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><LangVersion>14.0</LangVersion><PlatformTarget>x64</PlatformTarget><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks><EnableDefaultCompileItems>false</EnableDefaultCompileItems><GenerateAssemblyInfo>false</GenerateAssemblyInfo><StartupObject>VpnServiceNative.TestProgram</StartupObject></PropertyGroup><ItemGroup><PackageReference Include="System.ServiceProcess.ServiceController" Version="10.0.0"/><Compile Include="$compileRoot/**/*.cs"/><Compile Include="$compileHarness"/></ItemGroup></Project>
"@
$csproj=Join-Path $work 'VpnServiceNative.csproj'
[IO.File]::WriteAllText($csproj,$xml,[Text.UTF8Encoding]::new($false))
$saved=@{}
foreach($name in @('DOTNET_ROOT','DOTNET_CLI_HOME','DOTNET_ADD_GLOBAL_TOOLS_TO_PATH','NUGET_PACKAGES','TEMP','TMP')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
  $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='0'
  $env:DOTNET_ROOT=[IO.Path]::GetDirectoryName($sdk);$env:DOTNET_CLI_HOME=Join-Path $work 'dotnet-home';$env:NUGET_PACKAGES=Join-Path $WorkRoot 'nuget';$env:TEMP=$work;$env:TMP=$work
  & $sdk build $csproj -c Release --nologo *> (Join-Path $work 'build.txt')
  if($LASTEXITCODE -ne 0){throw "Native harness build failed: $work/build.txt"}
  & (Join-Path $work 'bin/Release/net10.0-windows/VpnServiceNative.exe') $work *> (Join-Path $work 'run.txt')
  if($LASTEXITCODE -ne 0){throw "Native harness failed: $work/run.txt"}
  $result=Get-Content -LiteralPath (Join-Path $work 'run.txt') -Raw | ConvertFrom-Json
  if($result.passed -ne $true){throw 'Native harness did not confirm pass.'}
  @{result=$result;sourceHashes=$hashes;harnessSha256=(Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $work 'receipt.json') -Encoding utf8
  Write-Output (Join-Path $work 'receipt.json')
  Get-Content -LiteralPath (Join-Path $work 'run.txt') -Raw
}finally{foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
