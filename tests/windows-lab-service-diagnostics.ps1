$ErrorActionPreference='Continue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$timer=[Diagnostics.Stopwatch]::StartNew()
& sc.exe queryex EgoistShieldCore
& sc.exe queryex EgoistShieldTelegramProxy
Write-Output ('SC_QUERY_MS='+$timer.ElapsedMilliseconds)
$timer.Restart()
Get-Service 'EgoistShield*' | Select-Object Name,Status | ConvertTo-Json -Compress
Write-Output ('SERVICE_CONTROLLER_MS='+$timer.ElapsedMilliseconds)
$timer.Restart()
Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 4 -Compress
Write-Output ('DNS_CIM_MS='+$timer.ElapsedMilliseconds)
foreach($file in Get-ChildItem 'C:\ProgramData\EgoistShield\Runtime\TelegramProxy' -Recurse -Filter '*.log' -ErrorAction SilentlyContinue){
  $text=([IO.File]::ReadAllLines($file.FullName)|Select-Object -Last 35) -join "`n"
  $text=[regex]::Replace($text,'(?i)\b[a-f0-9]{32,}\b','[redacted]')
  $text=[regex]::Replace($text,'tg://\S+','[telegram-link-redacted]')
  Write-Output ($file.Name+'='+$text)
}
