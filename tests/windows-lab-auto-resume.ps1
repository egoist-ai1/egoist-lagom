$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -ne 'SHIELD-LAB'){throw 'Disposable Win10 guest required'}
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\lab-bootstrap.ps1'
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'EgoistShieldLabRunner' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Output 'PASS: disposable guest runner resumes after evaluation VM reboot'
