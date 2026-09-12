$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$before=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
$timer=[Diagnostics.Stopwatch]::StartNew()
$result=& 'C:\Program Files\EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe' --notify-system-proxy
if($LASTEXITCODE -ne 0){throw 'Native proxy notification failed'}
$parsed=$result|ConvertFrom-Json
if(-not $parsed.ok -or -not $parsed.settingsChanged -or -not $parsed.refreshed){throw 'Native proxy notification did not confirm both WinINet calls'}
$after=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
if(($before|ConvertTo-Json -Compress) -ne ($after|ConvertTo-Json -Compress)){throw 'Notification changed proxy values'}
[pscustomobject]@{ok=$true;ms=$timer.ElapsedMilliseconds;code=$parsed.code}|ConvertTo-Json -Compress
Write-Output 'PASS: per-user native proxy notification and unchanged registry values'
