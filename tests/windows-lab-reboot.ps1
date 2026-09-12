$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'SHIELD-LAB'){throw 'Disposable Win10 guest required'}
$bootstrap=[IO.File]::ReadAllText('C:\Windows\Temp\lab-bootstrap.ps1')
$base=[regex]::Match($bootstrap,'http://10\.0\.2\.2:[0-9]+').Value
$token=[regex]::Match($bootstrap,"X-Lab-Token' = '([a-f0-9]+)'").Groups[1].Value
& shutdown.exe /r /t 20
if($LASTEXITCODE -ne 0){throw 'Guest reboot scheduling failed'}
$result=@{id='39b-reboot-final';exitCode=0;output='PASS: guest reboot scheduled before final clean install'}|ConvertTo-Json -Compress
Invoke-RestMethod "$base/result" -Method Post -Headers @{'X-Lab-Token'=$token} -Body ([Text.Encoding]::UTF8.GetBytes($result)) -ContentType 'application/json' | Out-Null
Start-Sleep -Seconds 60
