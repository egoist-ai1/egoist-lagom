$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')) { throw 'This integration test is restricted to the disposable SHIELD-LAB guest.' }
$base = (Get-Content C:\Windows\Temp\lab-bootstrap.ps1 -Raw | Select-String "http://10\.0\.2\.2:[0-9]+").Matches[0].Value
$token = (Get-Content C:\Windows\Temp\lab-bootstrap.ps1 -Raw | Select-String "X-Lab-Token' = '([a-f0-9]+)'" -AllMatches).Matches[0].Groups[1].Value
$headers = @{ 'X-Lab-Token' = $token }
$setup = 'C:\ShieldLab\EgoistShield-Setup.exe'
if(Test-Path 'D:\ShieldSetup.exe') {
  Copy-Item 'D:\ShieldSetup.exe' $setup -Force
  if((Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant() -ne (Get-Content D:\SHA256.txt -Raw).Trim()) { throw 'Setup media hash mismatch' }
} else { Invoke-WebRequest "$base/setup" -Headers $headers -OutFile $setup -UseBasicParsing }
$beforeDns = @(Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses)
$install = Start-Process -FilePath $setup -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
Write-Output "INSTALL_EXIT=$($install.ExitCode)"
if ($install.ExitCode -ne 0) {
  Get-ChildItem 'C:\ProgramData\EgoistShield' -Recurse -Filter '*journal*' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content $_.FullName -Tail 30 }
  throw "Setup failed: $($install.ExitCode)"
}
$installRoot = 'C:\Program Files\EgoistShield'
foreach ($required in @('EgoistShield.exe', 'resources\app.asar', 'resources\component-worker.cjs', 'resources\installation.json')) {
  if (-not (Test-Path (Join-Path $installRoot $required))) { throw "Missing: $required" }
}
if(Test-Path 'D:\VERSION.txt'){
  $expectedVersion=([IO.File]::ReadAllText('D:\VERSION.txt')).Trim()
  $installation=[IO.File]::ReadAllText((Join-Path $installRoot 'resources\installation.json'))|ConvertFrom-Json
  $appVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $installRoot 'EgoistShield.exe')).ProductVersion
  $coreVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $installRoot 'resources\core-service\win-x64\EgoistShield.Service.exe')).ProductVersion
  if($installation.version -ne $expectedVersion -or $appVersion.Split('-')[0] -ne $expectedVersion -or $coreVersion.Split('-')[0] -ne $expectedVersion){throw 'Installed app, Core or installation marker version differs from release media'}
  Write-Output ('PASS: app, Core and installation marker version='+$expectedVersion)
}
$core = Get-Service EgoistShieldCore
if (Test-Path (Join-Path $installRoot 'resources\scripts\system-control')) { throw 'Retired Windows control helper is still installed' }
Write-Output 'PASS: retired Windows control helper is absent'
if ($core.Status -ne 'Running') { throw 'Core service is not running' }
foreach ($name in @('EgoistShieldSystemDoH', 'EgoistShieldZapret', 'EgoistShieldTelegramProxy')) {
  $service = Get-Service $name -ErrorAction SilentlyContinue
  if ($service -and $service.Status -eq 'Running') { throw "Optional component started without opt-in: $name" }
}
Write-Output 'PASS: Core runs; optional network components remain off'
$afterDns = @(Get-DnsClientServerAddress | Select-Object InterfaceIndex, AddressFamily, ServerAddresses)
if (($beforeDns | ConvertTo-Json -Depth 4 -Compress) -ne ($afterDns | ConvertTo-Json -Depth 4 -Compress)) { throw 'Clean install changed adapter DNS' }
Write-Output 'PASS: clean install preserved adapter DNS'
$adminCheck=& "$installRoot\resources\core-service\win-x64\EgoistShield.Service.exe" --check-admin
if($LASTEXITCODE -ne 0){throw 'Native token check failed'}
$adminCheck=$adminCheck|ConvertFrom-Json
if(-not $adminCheck.ok -or -not $adminCheck.isAdmin){throw 'Native token check did not recognize the elevated installation test'}
Write-Output 'PASS: native token check recognized the elevated guest'
& "$installRoot\resources\core-service\win-x64\EgoistShield.Service.exe" --self-test
if ($LASTEXITCODE -ne 0) { throw 'Installed Core self-test failed' }
Get-CimInstance Win32_Service -Filter "Name LIKE 'EgoistShield%'" | Select-Object Name, State, StartMode, PathName | ConvertTo-Json -Compress
Write-Output 'PASS: installed Core self-test'
