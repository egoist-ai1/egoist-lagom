$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$bootstrap=[IO.File]::ReadAllText('C:\Windows\Temp\lab-bootstrap.ps1')
$base=[regex]::Match($bootstrap,'http://10\.0\.2\.2:[0-9]+').Value
$token=[regex]::Match($bootstrap,"X-Lab-Token' = '([a-f0-9]+)'").Groups[1].Value
$data=@{time=[DateTime]::UtcNow.ToString('o')}
$data.processes=@(Get-Process | Where-Object {$_.Name -match 'Egoist|powershell|xray|dism|TiWorker'} | Select-Object Id,Name,CPU,StartTime,Path,MainWindowTitle)
$data.services=@(Get-Service 'EgoistShield*' -ErrorAction SilentlyContinue | Select-Object Name,Status)
$data.files=@(Get-ChildItem 'C:\ShieldLab','C:\ProgramData\EgoistShield' -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'install|upgrade|journal'} | Select-Object FullName,Length,LastWriteTime)
foreach($file in 'C:\ShieldLab\11-install-v4.log','C:\ShieldLab\12-startup-v4.log','C:\ProgramData\EgoistShield\installer\upgrade-journal.json'){
 if(Test-Path $file){$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$reader=[IO.StreamReader]::new($stream);try{$data[$file]=$reader.ReadToEnd()}finally{$reader.Dispose()}}
}
$result=@{id='install-live-probe';output=($data|ConvertTo-Json -Depth 5 -Compress)}|ConvertTo-Json -Compress
Invoke-RestMethod "$base/result" -Method Post -Headers @{'X-Lab-Token'=$token} -Body ([Text.Encoding]::UTF8.GetBytes($result)) -ContentType 'application/json' | Out-Null
