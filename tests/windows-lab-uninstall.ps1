$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}
$root='C:\Program Files\EgoistShield'
$before=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
$foreign='C:\ShieldLab\UnrelatedApp'
New-Item -ItemType Directory -Path $foreign -Force | Out-Null
'Unrelated application data' | Set-Content (Join-Path $foreign 'preserve.txt')
$marker=(Get-FileHash (Join-Path $foreign 'preserve.txt')).Hash
Copy-Item C:\Windows\System32\ping.exe (Join-Path $foreign 'winws.exe') -Force
$foreignProcess=Start-Process (Join-Path $foreign 'winws.exe') -ArgumentList '127.0.0.1 -t' -WindowStyle Hidden -PassThru
$foreignStarted=$foreignProcess.StartTime
try {
  $uninstaller='C:\ShieldLab\uninstall-test.exe'
  Copy-Item (Join-Path $root 'Uninstall Egoist Shield.exe') $uninstaller -Force
  $process=Start-Process $uninstaller -ArgumentList '/S _?=C:\Program Files\EgoistShield' -WindowStyle Hidden -Wait -PassThru
  Write-Output ('UNINSTALL_EXIT=' + $process.ExitCode)
  if($process.ExitCode -ne 0){throw 'Uninstaller failed'}
  if(Test-Path $root){throw 'Installation directory remains after uninstall'}
  if(@(Get-Service 'EgoistShield*' -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned service remains after uninstall'}
  if(Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EgoistShield'){throw 'Uninstall registry entry remains'}
  $after=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
  if(($before | ConvertTo-Json -Depth 4 -Compress) -ne ($after | ConvertTo-Json -Depth 4 -Compress)){throw 'Uninstall changed baseline DNS'}
  $foreignProcess.Refresh()
  if($foreignProcess.HasExited){throw 'Uninstaller terminated unrelated winws.exe'}
  if((Get-FileHash (Join-Path $foreign 'preserve.txt')).Hash -ne $marker){throw 'Uninstaller changed unrelated application data'}
  Write-Output 'PASS: full uninstall removed owned files/services/registration and preserved DNS, foreign process and foreign data'
} finally {
  $live=Get-Process -Id $foreignProcess.Id -ErrorAction SilentlyContinue
  if($live -and $live.StartTime -eq $foreignStarted -and $live.Path -eq (Join-Path $foreign 'winws.exe')){Stop-Process -Id $live.Id -Force}
}
