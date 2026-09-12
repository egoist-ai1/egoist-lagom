$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$bootstrap=[IO.File]::ReadAllText('C:\Windows\Temp\lab-bootstrap.ps1')
$base=[regex]::Match($bootstrap,'http://10\.0\.2\.2:[0-9]+').Value
$token=[regex]::Match($bootstrap,"X-Lab-Token' = '([a-f0-9]+)'").Groups[1].Value
$data=@{}
foreach($name in 'component-progress.json','early-startup.txt','vpn-progress.json'){
  $file=Join-Path 'C:\ShieldLab' $name
  if(Test-Path $file){
    try{$stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$reader=New-Object IO.StreamReader($stream);try{$data[$name]=$reader.ReadToEnd()}finally{$reader.Dispose()}}
    catch{$data[$name]=$_.Exception.Message}
  }
}
$data['services']=@(Get-Service 'EgoistShield*' | Select-Object Name,Status)
$result=@{id='live-status';output=($data|ConvertTo-Json -Depth 4 -Compress)}|ConvertTo-Json -Compress
Invoke-RestMethod "$base/result" -Method Post -Headers @{'X-Lab-Token'=$token} -Body ([Text.Encoding]::UTF8.GetBytes($result)) -ContentType 'application/json' | Out-Null
