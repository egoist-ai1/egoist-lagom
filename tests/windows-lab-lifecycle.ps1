$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')) { throw 'Disposable Shield guest required' }
$root='C:\Program Files\EgoistShield'
$beforeDns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
$beforeHash=(Get-FileHash (Join-Path $root 'EgoistShield.exe') -Algorithm SHA256).Hash
$cleanup='C:\ShieldLab\owned-cleanup-lifecycle.ps1'
Copy-Item (Join-Path $root 'resources\installer\owned-cleanup.ps1') $cleanup -Force
$foreign='C:\ShieldLab\UnrelatedApp'
New-Item -ItemType Directory -Path $foreign -Force | Out-Null
Copy-Item C:\Windows\System32\ping.exe (Join-Path $foreign 'winws.exe') -Force
$foreignProcess=Start-Process (Join-Path $foreign 'winws.exe') -ArgumentList '127.0.0.1 -t' -WindowStyle Hidden -PassThru
$foreignStarted=$foreignProcess.StartTime
try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cleanup -Phase PreInstall -InstallRoot $root
  if($LASTEXITCODE -ne 0){throw 'Upgrade preparation failed'}
  Write-Output 'PASS: transactional upgrade preparation'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cleanup -Phase RollbackUpgrade -InstallRoot $root
  if($LASTEXITCODE -ne 0){throw 'Rollback failed'}
  if((Get-FileHash (Join-Path $root 'EgoistShield.exe') -Algorithm SHA256).Hash -ne $beforeHash){throw 'Rollback executable hash mismatch'}
  if((Get-Service EgoistShieldCore).Status -ne 'Running'){throw 'Rollback Core service not running'}
  $foreignProcess.Refresh()
  if($foreignProcess.HasExited){throw 'Cleanup terminated a foreign process with a matching runtime name'}
  Write-Output 'PASS: rollback restores exact executable and Core; unrelated winws.exe remains running'
  $afterDns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
  if(($beforeDns | ConvertTo-Json -Depth 4 -Compress) -ne ($afterDns | ConvertTo-Json -Depth 4 -Compress)){throw 'Rollback changed baseline DNS'}
  Write-Output 'PASS: rollback preserved adapter DNS'
} finally {
  $live=Get-Process -Id $foreignProcess.Id -ErrorAction SilentlyContinue
  if($live -and $live.StartTime -eq $foreignStarted -and $live.Path -eq (Join-Path $foreign 'winws.exe')){Stop-Process -Id $live.Id -Force}
}
