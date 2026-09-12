$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}
Write-Output ('OS=' + [Environment]::OSVersion.Version)
Get-Service 'EgoistShield*' -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | ConvertTo-Json -Compress
Get-Content 'C:\Program Files\EgoistShield\resources\installation.json' -ErrorAction SilentlyContinue
$timer=[Diagnostics.Stopwatch]::StartNew()
$doh=Get-Command Get-DnsClientDohServerAddress -ErrorAction SilentlyContinue
Write-Output ('NATIVE_DOH_SUPPORTED=' + [bool]$doh + '; LOOKUP_MS=' + $timer.ElapsedMilliseconds)
if($doh){
  $timer.Restart()
  Get-DnsClientDohServerAddress -ServerAddress '1.1.1.1','1.0.0.1' | ConvertTo-Json -Compress
  Write-Output ('NATIVE_DOH_READ_MS=' + $timer.ElapsedMilliseconds)
}
Get-ChildItem 'C:\ShieldLab' -File | Select-Object Name,Length | ConvertTo-Json -Compress
