[CmdletBinding()]
param(
  [Alias('Mode')][ValidateSet('Build','SelfTest','Launch')][string]$OrdinaryGuiMode='Launch',
  [Alias('WorkRoot')][string]$OrdinaryGuiWorkRoot='',
  [Alias('EvidenceDirectory')][string]$OrdinaryGuiEvidenceDirectory='',
  [Alias('CanonicalInstalledGuiPath')][string]$OrdinaryGuiInstalledPath='',
  [Alias('IntegrityManifestPath')][string]$OrdinaryGuiIntegrityPath='',
  [Alias('ExpectedSourceCommit')][ValidatePattern('^$|^[a-f0-9]{40}$')][string]$OrdinaryGuiCommit='',
  [Alias('ExpectedHarnessSourceCommit')][ValidatePattern('^$|^[a-f0-9]{40}$')][string]$OrdinaryGuiHarnessCommit='',
  [Alias('CaptureStandardStreams')][bool]$OrdinaryGuiCaptureStandardStreams=$true,
  [Alias('LaunchPolicy')][ValidateSet('ordinary','elevated')][string]$OrdinaryGuiLaunchPolicy='ordinary',
  [Alias('LeaseSeconds')][ValidateRange(10,600)][int]$OrdinaryGuiLeaseSeconds=420,
  [Alias('LibraryOnly')][switch]$OrdinaryGuiLibraryOnly
)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$script:OrdinaryGuiTestsRoot=$PSScriptRoot
# Import guard bodies in a child scope. Library parameters do not overwrite the
# caller's Mode/LibraryOnly/source identity or install acceptance variables.
$script:OrdinaryGuiGuards=& {
  . (Join-Path $script:OrdinaryGuiTestsRoot 'windows-production-acceptance.ps1') -LibraryOnly
  return @{Environment=(Get-Command Get-NativeAcceptanceEnvironmentErrors -CommandType Function).ScriptBlock;Path=(Get-Command Assert-NativeOrdinaryPath -CommandType Function).ScriptBlock;Within=(Get-Command Assert-NativePathWithin -CommandType Function).ScriptBlock}
}
function Assert-OrdinaryGuiPath {
  param([string]$Path,[switch]$Leaf)
  & $script:OrdinaryGuiGuards.Path -Path $Path -Leaf:$Leaf
}

function Build-OrdinaryGuiHarness {
  param([Parameter(Mandatory=$true)][string]$WorkRoot)
  if(-not [IO.Path]::IsPathFullyQualified($WorkRoot)){throw 'Absolute owned work required.'}
  Assert-OrdinaryGuiPath -Path $WorkRoot
  $directory=Join-Path ([IO.Path]::GetFullPath($WorkRoot)) ('ordinary-gui-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
  [void][IO.Directory]::CreateDirectory($directory)
  $projectRoot=[IO.Path]::GetFullPath((Join-Path $script:OrdinaryGuiTestsRoot '..'))
  $sdk=if($env:SHIELD_DOTNET){[IO.Path]::GetFullPath($env:SHIELD_DOTNET)}else{Join-Path $projectRoot '.tools\dotnet-10.0.401\dotnet.exe'}
  Assert-OrdinaryGuiPath -Path $sdk -Leaf
  $frozen=Join-Path $directory 'src';[void][IO.Directory]::CreateDirectory($frozen)
  $hashes=@()
  foreach($name in @('ProtectedExecutable.cs','ClientAuthorizer.cs','ClientIdentity.cs','ServiceOptions.cs','ServiceConfig.cs','TrustedPath.cs','GuiLaunchPolicy.cs')){
    $original=Join-Path $projectRoot ('src\service\EgoistShield.Service\'+$name)
    $destination=Join-Path $frozen $name
    [IO.File]::WriteAllBytes($destination,[IO.File]::ReadAllBytes($original))
    $hashes+=[ordered]@{file=('src/service/EgoistShield.Service/'+$name);sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash}
  }
  $harness=Join-Path $frozen 'windows-ordinary-gui.cs'
  [IO.File]::WriteAllBytes($harness,[IO.File]::ReadAllBytes((Join-Path $script:OrdinaryGuiTestsRoot 'windows-ordinary-gui.cs')))
  $hashes+=[ordered]@{file='tests/windows-ordinary-gui.cs';sha256=(Get-FileHash -LiteralPath $harness -Algorithm SHA256).Hash}
  $hashes+=[ordered]@{file='tests/windows-ordinary-gui.ps1';sha256=(Get-FileHash -LiteralPath (Join-Path $script:OrdinaryGuiTestsRoot 'windows-ordinary-gui.ps1') -Algorithm SHA256).Hash}
  [IO.File]::WriteAllText((Join-Path $directory 'source-hashes.json'),($hashes | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
  $source=[Security.SecurityElement]::Escape($frozen)
  $project=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><PlatformTarget>x64</PlatformTarget><LangVersion>14.0</LangVersion><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings><AllowUnsafeBlocks>true</AllowUnsafeBlocks><EnableDefaultCompileItems>false</EnableDefaultCompileItems><StartupObject>OrdinaryGuiHarness.Program</StartupObject></PropertyGroup><ItemGroup><Compile Include="$source\*.cs"/></ItemGroup></Project>
"@
  $projectFile=Join-Path $directory 'OrdinaryGuiHarness.csproj'
  [IO.File]::WriteAllText($projectFile,$project,[Text.UTF8Encoding]::new($false))
  $saved=@{}
  foreach($name in @('TEMP','TMP','DOTNET_ROOT','DOTNET_CLI_HOME','DOTNET_ADD_GLOBAL_TOOLS_TO_PATH','DOTNET_CLI_TELEMETRY_OPTOUT','DOTNET_SKIP_FIRST_TIME_EXPERIENCE','DOTNET_GENERATE_ASPNET_CERTIFICATE')){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
  try{
    $env:TEMP=$directory;$env:TMP=$directory;$env:DOTNET_ROOT=[IO.Path]::GetDirectoryName($sdk)
    $env:DOTNET_ADD_GLOBAL_TOOLS_TO_PATH='0'
    $env:DOTNET_CLI_HOME=Join-Path $directory 'dotnet-home';$env:DOTNET_CLI_TELEMETRY_OPTOUT='1';$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE='1';$env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
    & $sdk build $projectFile -c Release --nologo *> (Join-Path $directory 'build.txt')
    $buildExitCode=$LASTEXITCODE
    if($buildExitCode -ne 0){
      # Export only bounded compiler codes and known source locations. Raw
      # messages, paths, commands and environment remain in the local build.txt.
      $sourceFiles=@('ProtectedExecutable.cs','ClientAuthorizer.cs','ClientIdentity.cs','ServiceOptions.cs','ServiceConfig.cs','TrustedPath.cs','GuiLaunchPolicy.cs','windows-ordinary-gui.cs','OrdinaryGuiHarness.csproj')
      $diagnostics=[Collections.Generic.List[object]]::new()
      foreach($line in @(Get-Content -LiteralPath (Join-Path $directory 'build.txt') -Encoding UTF8 -Tail 40)){
        if($line -notmatch '(?i)\b(?<kind>error|warning)\s+(?<code>[A-Z]{2,12}[0-9]{2,6})\s*:'){continue}
        $row=[ordered]@{kind=$Matches.kind.ToLowerInvariant();code=$Matches.code.ToUpperInvariant();source=$null;line=$null;column=$null}
        if($line -match '(?<file>[A-Za-z0-9_.-]+\.(?:cs|csproj))\((?<line>[0-9]{1,6})(?:,(?<column>[0-9]{1,6}))?\)\s*:'){
          if($Matches.file -cin $sourceFiles){$row.source=$Matches.file;$row.line=[int]$Matches.line;if($Matches.ContainsKey('column') -and $Matches.column){$row.column=[int]$Matches.column}}
        }
        $diagnostics.Add([pscustomobject]$row)
        Write-Host ('Ordinary GUI compiler {0} {1}; source={2}; line={3}; column={4}' -f $row.kind,$row.code,$row.source,$row.line,$row.column)
      }
      $compilerReport=[ordered]@{schemaVersion=1;buildExitCode=$buildExitCode;targetFramework='net10.0-windows';tailLines=40;maxDiagnostics=40;diagnostics=@($diagnostics.ToArray())}
      [IO.File]::WriteAllText((Join-Path $directory 'compiler-diagnostics.json'),($compilerReport|ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
      throw "Ordinary GUI harness build failed: $directory\build.txt"
    }
  }finally{foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
  return [pscustomobject]@{Directory=$directory;Executable=(Join-Path $directory 'bin\Release\net10.0-windows\OrdinaryGuiHarness.exe');DotnetRoot=[IO.Path]::GetDirectoryName($sdk);SourceHashes=(Join-Path $directory 'source-hashes.json')}
}

function Read-OrdinaryGuiJson {
  param([Parameter(Mandatory=$true)][string]$Path)
  $raw=Get-Content -LiteralPath $Path -Raw
  if((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')){return ConvertFrom-Json -InputObject $raw -DateKind String}
  return ConvertFrom-Json -InputObject $raw
}
function Resolve-OrdinaryGuiHarnessSourceCommit {
  param([string]$ExpectedSourceCommit,[string]$ExpectedHarnessSourceCommit='')
  $resolved=if($ExpectedHarnessSourceCommit){$ExpectedHarnessSourceCommit}else{$ExpectedSourceCommit}
  if($ExpectedSourceCommit -cnotmatch '^[a-f0-9]{40}$' -or $resolved -cnotmatch '^[a-f0-9]{40}$'){throw 'Artifact and harness source commits must be exact lowercase40hex.'}
  return $resolved
}
function Save-OrdinaryGuiHelperDrains {
  param($Guardian,$Output,$Errors,$Build,[string]$Stage)
  $record=[ordered]@{stage=$Stage;guardianProcessId=$Guardian.Id;exited=$Guardian.HasExited;exitCode=$null;streams=@()}
  if($record.exited){
    $record.exitCode=$Guardian.ExitCode
    foreach($entry in @(@{name='stdout';task=$Output},@{name='stderr';task=$Errors})){
      $state=[ordered]@{name=$entry.name;status='incomplete';bytes=$null;path=$null}
      try{
        if($entry.task.Wait(2000)){
          $raw=$entry.task.GetAwaiter().GetResult();$state.bytes=[Text.Encoding]::UTF8.GetByteCount($raw)
          if($state.bytes -le 1048576){$state.path=Join-Path $Build.Directory ('run.'+$entry.name+'.txt');[IO.File]::WriteAllText($state.path,$raw,[Text.UTF8Encoding]::new($false));$state.status='saved'}else{$state.status='exceeded-bound-not-written'}
        }
      }catch{$state.status='unavailable';$state.error=$_.Exception.Message}
      $record.streams+=,$state
    }
  }
  [IO.File]::WriteAllText((Join-Path $Build.Directory 'guardian-diagnostics.json'),($record|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
}
function Assert-OrdinaryGuiHostedInputs {
  param([string]$CanonicalInstalledGuiPath,[string]$IntegrityManifestPath,[string]$ExpectedSourceCommit,[string]$WorkRoot,[string]$EvidenceDirectory,[string]$ExpectedHarnessSourceCommit='',[bool]$CaptureStandardStreams=$true)
  $environment=@{}
  foreach($name in @('GITHUB_ACTIONS','CI','RUNNER_ENVIRONMENT','RUNNER_OS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA')){$environment[$name]=[Environment]::GetEnvironmentVariable($name)}
  $administrator=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $errors=@(& $script:OrdinaryGuiGuards.Environment -Environment $environment -Administrator $administrator -Windows ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT))
  if($errors.Count -ne 0){throw ('Ordinary GUI hosted guard refused before launch: '+($errors -join ', '))}
  $harnessSource=Resolve-OrdinaryGuiHarnessSourceCommit -ExpectedSourceCommit $ExpectedSourceCommit -ExpectedHarnessSourceCommit $ExpectedHarnessSourceCommit
  if($harnessSource -cne $env:GITHUB_SHA){throw 'Harness source commit must match actual GITHUB_SHA.'}
  if(-not $CaptureStandardStreams -and (-not $ExpectedHarnessSourceCommit -or $harnessSource -ceq $ExpectedSourceCommit)){throw 'Original stream/inheritance mode requires explicit diagnostic harness source.'}
  Assert-OrdinaryGuiPath -Path $env:RUNNER_TEMP
  Assert-OrdinaryGuiPath -Path $env:GITHUB_WORKSPACE
  [void](& $script:OrdinaryGuiGuards.Within -Path $WorkRoot -Root $env:RUNNER_TEMP)
  [void](& $script:OrdinaryGuiGuards.Within -Path $EvidenceDirectory -Root $env:RUNNER_TEMP)
  [void](& $script:OrdinaryGuiGuards.Within -Path $EvidenceDirectory -Root $WorkRoot)
  [void](& $script:OrdinaryGuiGuards.Within -Path $IntegrityManifestPath -Root $env:GITHUB_WORKSPACE)
  Assert-OrdinaryGuiPath -Path $WorkRoot
  Assert-OrdinaryGuiPath -Path $EvidenceDirectory
  Assert-OrdinaryGuiPath -Path $IntegrityManifestPath -Leaf
  $canonical=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'EgoistShield\EgoistShield.exe'
  if([IO.Path]::GetFullPath($CanonicalInstalledGuiPath) -ine $canonical){throw 'Only the canonical installed GUI is allowed.'}
  Assert-OrdinaryGuiPath -Path $canonical -Leaf
}

function Start-OrdinaryGuiLease {
  param([Parameter(Mandatory=$true)][string]$CanonicalInstalledGuiPath,
    [Parameter(Mandatory=$true)][string]$IntegrityManifestPath,
    [Parameter(Mandatory=$true)][string]$ExpectedSourceCommit,
    [string]$ExpectedHarnessSourceCommit='',
    [bool]$CaptureStandardStreams=$true,
    [ValidateSet('ordinary','elevated')][string]$LaunchPolicy='ordinary',
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [ValidateRange(10,600)][int]$LeaseSeconds=420)
  Assert-OrdinaryGuiHostedInputs -CanonicalInstalledGuiPath $CanonicalInstalledGuiPath -IntegrityManifestPath $IntegrityManifestPath -ExpectedSourceCommit $ExpectedSourceCommit -WorkRoot $WorkRoot -EvidenceDirectory $EvidenceDirectory -ExpectedHarnessSourceCommit $ExpectedHarnessSourceCommit -CaptureStandardStreams $CaptureStandardStreams
  $build=Build-OrdinaryGuiHarness -WorkRoot $WorkRoot
  $receipt=Join-Path $EvidenceDirectory ('ordinary-gui-'+[Guid]::NewGuid().ToString('N')+'.json')
  $options=[ordered]@{mode='launch';workRoot=[IO.Path]::GetFullPath($WorkRoot);receiptPath=$receipt;canonicalInstalledGuiPath=[IO.Path]::GetFullPath($CanonicalInstalledGuiPath);integrityManifestPath=[IO.Path]::GetFullPath($IntegrityManifestPath);expectedSourceCommit=$ExpectedSourceCommit;expectedHarnessSourceCommit=$ExpectedHarnessSourceCommit;captureStandardStreams=$CaptureStandardStreams;launchPolicy=$LaunchPolicy;leaseSeconds=$LeaseSeconds;windowTimeoutSeconds=90}
  $optionsPath=Join-Path $build.Directory 'options.json'
  [IO.File]::WriteAllText($optionsPath,($options | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$build.Executable;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  foreach($name in @($info.Environment.Keys)){if($name -match '^(DOTNET_|COMPLUS_|CORECLR_|COR_)'){[void]$info.Environment.Remove($name)}}
  $info.Environment['DOTNET_ROOT']=$build.DotnetRoot;$info.Environment['DOTNET_ROOT_X64']=$build.DotnetRoot
  $info.ArgumentList.Add('--options');$info.ArgumentList.Add($optionsPath)
  $guardian=[Diagnostics.Process]::new();$guardian.StartInfo=$info
  try{
    if(-not $guardian.Start()){throw 'Ordinary GUI guardian did not start.'}
    $output=$guardian.StandardOutput.ReadToEndAsync();$errors=$guardian.StandardError.ReadToEndAsync()
    $watch=[Diagnostics.Stopwatch]::StartNew();$ready=$null
    while($watch.Elapsed.TotalSeconds -lt 105){
      if(Test-Path -LiteralPath $receipt){$ready=Read-OrdinaryGuiJson -Path $receipt;if($ready.stage -ne 'launched'){throw "Ordinary GUI did not launch: $($ready.error)"};break}
      if($guardian.HasExited){throw ('Ordinary GUI guardian exited: '+$errors.GetAwaiter().GetResult())}
      Start-Sleep -Milliseconds 100
    }
    if(-not $ready -or $ready.launchPolicy -cne $LaunchPolicy){throw 'Actual GUI launch policy proof is missing.'}
    if($LaunchPolicy -eq 'elevated'){
      if($ready.elevatedGui -ne $true -or $ready.guiRequestedExecutionLevel -cne 'asInvoker' -or $ready.token.elevated -ne $true -or $ready.token.administratorsEnabled -ne $true -or $ready.token.integrityRid -lt 12288 -or $ready.token.uiAccess -ne $false -or $ready.token.tokenType -ne 1 -or $ready.token.userSid -cne $ready.runnerToken.userSid -or $ready.token.sessionId -ne $ready.runnerToken.sessionId){throw 'Actual current elevated administrator GUI proof is missing.'}
    }elseif($ready.token.elevated -or $ready.token.administratorsEnabled -or $ready.token.integrityRid -ne 8192 -or $ready.token.uiAccess){throw 'Actual ordinary medium GUI token proof is missing.'}
    return [pscustomobject]@{Guardian=$guardian;Receipt=$ready;ReceiptPath=$receipt;Output=$output;Errors=$errors;Build=$build}
  }catch{
    $primary=$_
    try{
      $before=[ordered]@{processId=$guardian.Id;hasExited=$guardian.HasExited;exitCode=$(if($guardian.HasExited){$guardian.ExitCode}else{$null});error=$primary.Exception.Message}
      [IO.File]::WriteAllText((Join-Path $build.Directory 'guardian-before-cleanup.json'),($before|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
      if(-not $guardian.HasExited){[void]$guardian.WaitForExit(2000)}
      if(-not $guardian.HasExited){$guardian.Kill();[void]$guardian.WaitForExit(10000)}
      Save-OrdinaryGuiHelperDrains -Guardian $guardian -Output $output -Errors $errors -Build $build -Stage 'launch-failed'
    }catch{Write-Warning ('Own guardian diagnostics unavailable: '+$_.Exception.Message)}
    $guardian.Dispose();throw $primary
  }
}

function Start-ElevatedGuiLease {
  param([Parameter(Mandatory=$true)][string]$CanonicalInstalledGuiPath,
    [Parameter(Mandatory=$true)][string]$IntegrityManifestPath,
    [Parameter(Mandatory=$true)][string]$ExpectedSourceCommit,
    [string]$ExpectedHarnessSourceCommit='',
    [bool]$CaptureStandardStreams=$true,
    [Parameter(Mandatory=$true)][string]$WorkRoot,
    [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
    [ValidateRange(10,600)][int]$LeaseSeconds=420)
  return Start-OrdinaryGuiLease @PSBoundParameters -LaunchPolicy elevated
}
function Stop-ElevatedGuiLease {
  param([Parameter(Mandatory=$true)]$Lease)
  $final=Stop-OrdinaryGuiLease -Lease $Lease
  if($final.launch.launchPolicy -cne 'elevated' -or $final.launch.elevatedGui -ne $true){throw 'Elevated GUI lease cleanup lost its explicit launch policy proof.'}
  return $final
}

function Stop-OrdinaryGuiLease {
  param([Parameter(Mandatory=$true)]$Lease)
  try{
    if(-not $Lease.Guardian.HasExited){
      [IO.File]::WriteAllText([string]$Lease.Receipt.stopPath,('stop:'+[string]$Lease.Receipt.stopNonce),[Text.UTF8Encoding]::new($false))
      if(-not $Lease.Guardian.WaitForExit(15000)){$Lease.Guardian.Kill();[void]$Lease.Guardian.WaitForExit(10000);throw 'Guardian did not acknowledge cleanup; its job was closed by terminating the owned handle.'}
    }
    Save-OrdinaryGuiHelperDrains -Guardian $Lease.Guardian -Output $Lease.Output -Errors $Lease.Errors -Build $Lease.Build -Stage 'lease-stop'
    $final=Read-OrdinaryGuiJson -Path $Lease.ReceiptPath
    if($Lease.Guardian.ExitCode -ne 0 -or $final.stage -ne 'completed' -or -not $final.cleanup.noOrphans -or $final.cleanup.activeProcesses -ne 0){throw 'Ordinary GUI cleanup lacks an accepted zero-orphan readback.'}
    return $final
  }finally{$Lease.Guardian.Dispose()}
}

if($OrdinaryGuiLibraryOnly){return}
if(-not $OrdinaryGuiWorkRoot){throw 'WorkRoot is required.'}
if($OrdinaryGuiMode -eq 'Build'){Build-OrdinaryGuiHarness -WorkRoot $OrdinaryGuiWorkRoot | ConvertTo-Json;return}
if($OrdinaryGuiMode -eq 'SelfTest'){
  if($OrdinaryGuiInstalledPath -or $OrdinaryGuiIntegrityPath -or $OrdinaryGuiCommit -or $OrdinaryGuiHarnessCommit){throw 'SelfTest can launch only its own fixed harmless child.'}
  $build=Build-OrdinaryGuiHarness -WorkRoot $OrdinaryGuiWorkRoot
  $receipt=Join-Path $build.Directory 'self-test.json'
  $options=[ordered]@{mode='self-test';workRoot=[IO.Path]::GetFullPath($OrdinaryGuiWorkRoot);receiptPath=$receipt;launchPolicy=$OrdinaryGuiLaunchPolicy;leaseSeconds=10;windowTimeoutSeconds=1}
  $optionsPath=Join-Path $build.Directory 'options.json'
  [IO.File]::WriteAllText($optionsPath,($options | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  $savedDotnetRoot=$env:DOTNET_ROOT
  try{$env:DOTNET_ROOT=$build.DotnetRoot;& $build.Executable --options $optionsPath *> (Join-Path $build.Directory 'run.txt');$result=$LASTEXITCODE}finally{$env:DOTNET_ROOT=$savedDotnetRoot}
  Get-Content -LiteralPath (Join-Path $build.Directory 'run.txt')
  Write-Output ('ORDINARY_GUI_BUILD='+$build.Directory)
  if($result -ne 0){throw 'Ordinary GUI self-test failed; inspect the owned evidence.'};return
}
$lease=Start-OrdinaryGuiLease -CanonicalInstalledGuiPath $OrdinaryGuiInstalledPath -IntegrityManifestPath $OrdinaryGuiIntegrityPath -ExpectedSourceCommit $OrdinaryGuiCommit -ExpectedHarnessSourceCommit $OrdinaryGuiHarnessCommit -CaptureStandardStreams $OrdinaryGuiCaptureStandardStreams -LaunchPolicy $OrdinaryGuiLaunchPolicy -WorkRoot $OrdinaryGuiWorkRoot -EvidenceDirectory $OrdinaryGuiEvidenceDirectory -LeaseSeconds $OrdinaryGuiLeaseSeconds
try{$lease.Receipt | ConvertTo-Json -Depth 10;[void]$lease.Guardian.WaitForExit(($OrdinaryGuiLeaseSeconds+15)*1000)}finally{Stop-OrdinaryGuiLease -Lease $lease | ConvertTo-Json -Depth 12}
