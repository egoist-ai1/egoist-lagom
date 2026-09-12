$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$files=Get-ChildItem 'C:\ShieldLab\vpn-data' -Recurse -File | Where-Object Extension -In '.log','.txt'
$files+=Get-Item 'C:\ShieldLab\vpn-stderr.txt' -ErrorAction SilentlyContinue
foreach($file in $files){
  $body=[IO.File]::ReadAllText($file.FullName)
  $counts=@{}
  foreach($pattern in @('timeout','timed out','no such host','certificate','handshake','refused','unreachable','DNS','TLS','connectex','failed','error','closed','cancel')){$counts[$pattern]=[regex]::Matches($body,$pattern,'IgnoreCase').Count}
  [pscustomobject]@{file=$file.Name;bytes=$file.Length;categories=$counts} | ConvertTo-Json -Compress
}
Get-ChildItem 'C:\ShieldLab\vpn-data' -Recurse -File | Select-Object Name,Length
